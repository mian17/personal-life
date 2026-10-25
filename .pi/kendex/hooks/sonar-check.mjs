#!/usr/bin/env node
// SonarQube gate on Write/Edit: the content a write would produce is the
// content analysed, and any finding refuses the write with the rule keys in
// hand.
//
// The analysed bytes are built with Pi's own edit engine, not a copy of it, so
// what this judges is what the tool would have written: fuzzy matching, smart
// quote and dash folding, BOM handling and line-ending restoration all behave
// exactly as they do on the real call.
//
// Exit 0 allows; exit 2 refuses with the reason on stderr.
//
// A path this gate does not measure (outside the project, outside
// `sonar.sources`, a language SonarQube cannot parse) is allowed: it is not a
// verdict about code quality, it is this gate not having business there.
//
// A path it DOES measure and cannot analyse — the MCP gateway is down, the
// session could not be opened, the tool did not answer — is the opposite case:
// silence would be mistaken for a clean file. Those refuse. Set
// KENDEX_SONAR_FAIL_OPEN=1 to restore the earlier fail-open behaviour (allow);
// it exists because a gate that stops all work when a container restarts is its
// own outage, and that was the stated preference before delegated children made
// a silent pass more dangerous than a blocked write.

import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { resolve, isAbsolute, extname, basename, relative, sep } from "node:path";
import { execFile, execFileSync } from "node:child_process";

const PI_ROOT = "/usr/local/share/npm-global/lib/node_modules/@earendil-works/pi-coding-agent";
const MCP_URL = "http://mcp-gateway.docker.internal/mcp";
// The gateway mounts the repository here, and `analyze_code_snippet` refuses a
// path outside it. Host-absolute paths ("/home/night/...") are rejected, so
// every path this hook sends is relative to the mount root.
const MOUNT_ROOT = "/app/mcp-workspace";
/** A path this gate measures but cannot get a verdict for. Distinct from
 * `undefined`, which means the gate has no business with the path at all. */
const UNAVAILABLE = Symbol("sonar-gate-unavailable");
const FAIL_OPEN = process.env.KENDEX_SONAR_FAIL_OPEN === "1";
const PROBE_TIMEOUT_MS = 4000;
const ANALYZE_TIMEOUT_MS = 110_000;

// SonarQube's own language keys, read off the tool's schema. The extension
// picks one; `docker` has none, and a `.mjs` is `js` to the analyzer.
const BY_EXTENSION = new Map([
	[".ts", "ts"], [".mts", "ts"], [".cts", "ts"],
	[".tsx", "tsx"],
	[".js", "js"], [".mjs", "js"], [".cjs", "js"],
	[".jsx", "jsx"],
	[".css", "css"],
	[".scss", "scss"],
	[".less", "less"],
]);
const DOCKERFILE = /^(?:Dockerfile|Containerfile)(?:\..+)?$/i;

/** Test bodies are judged by `TEST`; analysed as `MAIN` they lose `S2699`. */
function scopeOf(file) {
	return /(?:^|\/)(?:test|tests|__tests__)\/|[.\-](?:test|spec)\.[cm]?[jt]sx?$|e2e-spec/.test(file) ? "TEST" : "MAIN";
}

function languageOf(absolute) {
	const name = basename(absolute);
	if (DOCKERFILE.test(name)) return "docker";
	return BY_EXTENSION.get(extname(name).toLowerCase());
}

/** Pi applies a legacy single-edit shape and a JSON-string `edits` the same
 * way its own tool does, so a call spelled either way is judged as written. */
function normaliseEdits(input) {
	let edits = input.edits;
	if (typeof edits === "string") {
		try {
			edits = JSON.parse(edits);
		} catch {
			return undefined;
		}
	}
	if (edits !== null && typeof edits === "object" && !Array.isArray(edits)
		&& typeof edits.oldText === "string" && typeof edits.newText === "string") {
		edits = [edits];
	}
	if (!Array.isArray(edits)) edits = [];
	if (typeof input.oldText === "string" && typeof input.newText === "string") {
		edits = [...edits, { oldText: input.oldText, newText: input.newText }];
	}
	return edits.length === 0 ? undefined : edits;
}

/** The content the write tool would put on disk, or undefined when this call
 * is not one this gate can judge. */
function prospectiveContent(payload) {
	const input = payload.tool_input ?? {};
	if (payload.tool_name === "Write") {
		return typeof input.content === "string" ? input.content : undefined;
	}
	if (payload.tool_name !== "Edit") return undefined;
	const edits = normaliseEdits(input);
	if (edits === undefined) return undefined;
	const onDisk = readFileSync(input.file_path, "utf-8");
	const require_ = createRequire(PI_ROOT + "/");
	const { applyEditsToNormalizedContent } = require_(PI_ROOT + "/dist/core/tools/edit-diff.js");
	return applyEditsToNormalizedContent(onDisk, edits, input.file_path).newContent;
}

function curl(args, timeoutMs) {
	return new Promise((done, fail) => {
		execFile("curl", ["-sS", "--max-time", String(Math.ceil(timeoutMs / 1000)), ...args],
			{ timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout) => (error && stdout === "" ? fail(error) : done(String(stdout))));
	});
}

/** An MCP session id, or undefined when the server is not reachable. */
async function openSession() {
	const init = JSON.stringify({
		jsonrpc: "2.0", id: 1, method: "initialize",
		params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sonar-hook", version: "1" } },
	});
	let headers;
	try {
		headers = await curl(["-D", "-", "-o", "/dev/null", "-X", "POST", MCP_URL,
			"-H", "Content-Type: application/json",
			"-H", "Accept: application/json, text/event-stream",
			"-d", init], PROBE_TIMEOUT_MS);
	} catch {
		return undefined;
	}
	const session = /^mcp-session-id:\s*(\S+)$/im.exec(headers)?.[1];
	if (session === undefined) return undefined;
	try {
		await curl(["-X", "POST", MCP_URL,
			"-H", "Content-Type: application/json",
			"-H", "Accept: application/json, text/event-stream",
			"-H", `Mcp-Session-Id: ${session}`,
			"-d", '{"jsonrpc":"2.0","method":"notifications/initialized"}'], PROBE_TIMEOUT_MS);
	} catch {
		return undefined;
	}
	return session;
}

/** The tool's text answer, or undefined when the call did not answer. */
async function callTool(session, name, args, timeoutMs) {
	const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
	let out;
	try {
		out = await curl(["-X", "POST", MCP_URL,
			"-H", "Content-Type: application/json",
			"-H", "Accept: application/json, text/event-stream",
			"-H", `Mcp-Session-Id: ${session}`,
			"-d", body], timeoutMs);
	} catch {
		return undefined;
	}
	for (const line of out.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		let message;
		try {
			message = JSON.parse(line.slice(6));
		} catch {
			continue;
		}
		if (message.id !== 2 || message.error !== undefined) continue;
		if (message.result?.isError === true) return undefined;
		const text = message.result?.content?.[0]?.text;
		return typeof text === "string" ? text : undefined;
	}
	return undefined;
}

/** The findings in a tool answer, or undefined when it was not an analysis. */
function findingsIn(json) {
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		return undefined;
	}
	return typeof parsed === "object" && parsed !== null && Array.isArray(parsed.issues) ? parsed.issues : undefined;
}

function describe(issues) {
	return issues.map((issue) => {
		const line = issue.textRange?.startLine;
		return `${issue.ruleKey}${line === undefined ? "" : `:${line}`} ${issue.severity} — ${issue.primaryMessage}`;
	}).join("\n");
}

/** Where the analyzer reads this content, as the gateway sees it. The gateway
 * mounts the main checkout, so a path under a worktree is spelled from there:
 * a worktree lives at `<main>/.pi/worktrees/<name>`, which the shared git dir
 * names without assuming that layout. */
function mountedPath(absolute, root) {
	let base = root;
	try {
		const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
			{ cwd: root, encoding: "utf-8", timeout: 5_000 }).trim();
		if (common !== "") base = resolve(common, "..");
	} catch {
		// A root git cannot describe is spelled from itself, which is right
		// whenever it is the main checkout.
	}
	return `${MOUNT_ROOT}/${relative(base, absolute).split(sep).join("/")}`;
}

/** The directories `sonar.sources` measures. The gate judges what the scan
 * judges: this hook's own files, `.pi/` and any other scaffolding, are outside
 * that set, so they are not gated by themselves. */
const MEASURED_ROOTS = ["apps/", "packages/", "scripts/"];

function isMeasured(relativeToRoot) {
	const path = relativeToRoot.split(sep).join("/");
	return MEASURED_ROOTS.some((root) => path.startsWith(root));
}

/** This gate serves one SonarQube project. A path outside a checkout of it —
 * another repository opened in the same session — is not this gate's business,
 * which is also what lets the registry be installed globally, so worktrees
 * (which carry no `.pi/` of their own) are still gated. */
function isThisProject(root) {
	try {
		return /^sonar\.projectKey=personal-life$/m.test(readFileSync(resolve(root, "sonar-project.properties"), "utf-8"));
	} catch {
		return false;
	}
}

/** The findings SonarQube reports for `content`, judged as the file it is
 * written to. Undefined when no verdict is possible: the path is outside this
 * project, outside `sonar.sources`, of an unanalysable language, or the
 * analyzer could not be reached. Every no-verdict path is a pass. */
async function analyse(absolute, root, content, relativeToRoot) {
	if (!isThisProject(root)) return undefined;
	if (relativeToRoot === "" || relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return undefined;
	if (!isMeasured(relativeToRoot)) return undefined;
	const language = languageOf(absolute);
	if (language === undefined) return undefined;

	const session = await openSession();
	if (session === undefined) return UNAVAILABLE;

	// The analyzer reads from disk, so the prospective content is written beside
	// the file as the gateway can see it. Cleaned up whatever the outcome.
	const scratch = resolve(absolute, "..", ".sonar-hook-scratch", `${process.pid}-${basename(absolute)}`);
	const scratchInMount = mountedPath(scratch, root);
	try {
		mkdirSync(resolve(scratch, ".."), { recursive: true });
		writeFileSync(scratch, content);
	} catch {
		return undefined;
	}

	const analysis = await callTool(session, "analyze_code_snippet", {
		filePath: scratchInMount,
		language,
		scope: scopeOf(absolute),
	}, ANALYZE_TIMEOUT_MS);
	try {
		rmSync(scratch, { force: true });
		rmdirSync(resolve(scratch, ".."));
	} catch {
		// A scratch file or directory left behind is stale, not a verdict.
	}
	if (analysis === undefined) return UNAVAILABLE;

	const issues = findingsIn(analysis);
	return issues === undefined || issues.length === 0 ? undefined : issues;
}

function unavailableText(file) {
	return `${file} could not be analysed: the SonarQube gateway is unreachable or the tool did not answer.`;
}

/** Whether an unavailable verdict should refuse this run. */
function refusesWhenUnavailable() {
	return !FAIL_OPEN;
}

/** Write/Edit: the bytes the tool would put on disk, before it does. */
async function main() {
	const payload = JSON.parse(readFileSync(0, "utf-8"));
	const input = payload.tool_input ?? {};
	if (typeof input.file_path !== "string" || input.file_path === "") return 0;
	const root = payload.cwd ?? process.cwd();
	const absolute = isAbsolute(input.file_path) ? input.file_path : resolve(root, input.file_path);

	let content;
	try {
		content = prospectiveContent(payload);
	} catch {
		// The edit tool itself refuses this call; this gate has no opinion.
		return 0;
	}
	if (content === undefined) return 0;

	const issues = await analyse(absolute, root, content, relative(root, absolute));
	if (issues === undefined) return 0;
	if (issues === UNAVAILABLE) {
		if (!refusesWhenUnavailable()) return 0;
		process.stderr.write(`${unavailableText(input.file_path)}\nSet KENDEX_SONAR_FAIL_OPEN=1 to allow this write.\n`);
		return 2;
	}

	process.stderr.write(`${input.file_path} has ${issues.length} SonarQube finding(s):\n${describe(issues)}\n`);
	return 2;
}

/**
 * pre-commit: judged on the *staged* bytes, so a write that never went through
 * the Write/Edit tools (`bash` heredoc, `sed -i`, a script) is judged too.
 *
 * `git commit` runs this from the top of the worktree it commits in, so the
 * paths git reports are relative to `process.cwd()`. Nothing here is committed;
 * a refusal leaves the index and the working tree untouched.
 */
async function commitGate() {
	const root = process.cwd();
	const staged = stagedFiles(root);
	if (staged === undefined || staged.length === 0) return 0;

	const refused = [];
	for (const file of staged) {
		const absolute = resolve(root, file);
		const content = stagedContent(file);
		if (content === undefined) continue;
		const issues = await analyse(absolute, root, content, file);
		if (issues === undefined) continue;
		if (issues === UNAVAILABLE) {
			if (refusesWhenUnavailable()) refused.push(unavailableText(file));
			continue;
		}
		refused.push(`${file} has ${issues.length} SonarQube finding(s):\n${describe(issues)}`);
	}
	if (refused.length === 0) return 0;

	const remedy = FAIL_OPEN
		? "Nothing was committed."
		: "Nothing was committed. Fix any findings above; if something could not be analysed, retry once the gateway is back, or set KENDEX_SONAR_FAIL_OPEN=1 to commit anyway.";
	process.stderr.write(`${refused.join("\n\n")}\n\n${remedy}\n`);
	return 2;
}

/** Added, copied and modified files in the index, as git spells them. */
function stagedFiles(root) {
	try {
		const out = execFileSync("git", ["-c", "core.quotepath=off", "diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"],
			{ cwd: root, encoding: "utf-8", timeout: 10_000 });
		return out.split("\0").filter((path) => path !== "");
	} catch {
		return undefined;
	}
}

/** The staged blob, which is what the commit would contain, or undefined when
 * the file was deleted in the index (nothing to judge). */
function stagedContent(file) {
	try {
		return execFileSync("git", ["show", `:${file}`], { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024, timeout: 10_000 });
	} catch {
		return undefined;
	}
}

const entry = (process.env.KENDEX_HOOK_ENTRY ?? (process.argv[2] === "--staged" ? "commit" : "tool"));

(entry === "commit" ? commitGate() : main()).then(
	(code) => process.exit(code),
	() => process.exit(0),
);
