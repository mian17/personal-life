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
// Exit 0 allows; exit 2 refuses with the reason on stderr. Every unexpected
// path exits 0 as well. A gate that fails shut on a SonarQube restart stops all
// work, and one finding arriving late is the smaller failure.

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

async function main() {
	const payload = JSON.parse(readFileSync(0, "utf-8"));
	const input = payload.tool_input ?? {};
	if (typeof input.file_path !== "string" || input.file_path === "") return 0;
	const root = payload.cwd ?? process.cwd();
	if (!isThisProject(root)) return 0;
	const absolute = isAbsolute(input.file_path) ? input.file_path : resolve(root, input.file_path);
	// A path that escapes the checkout is not under the mount the analyzer reads
	// from, so no verdict about it is possible here.
	const inside = relative(root, absolute);
	if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return 0;
	if (!isMeasured(inside)) return 0;
	const language = languageOf(absolute);
	if (language === undefined) return 0;

	let content;
	try {
		content = prospectiveContent(payload);
	} catch {
		// The edit tool itself refuses this call; this gate has no opinion.
		return 0;
	}
	if (content === undefined) return 0;

	const session = await openSession();
	if (session === undefined) return 0;

	// The analyzer reads from disk, so the prospective content is written beside
	// the file as the gateway can see it. Cleaned up whatever the outcome.
	const scratch = resolve(absolute, "..", ".sonar-hook-scratch", `${process.pid}-${basename(absolute)}`);
	const scratchInMount = mountedPath(scratch, root);
	try {
		mkdirSync(resolve(scratch, ".."), { recursive: true });
		writeFileSync(scratch, content);
	} catch {
		return 0;
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
	if (analysis === undefined) return 0;

	const issues = findingsIn(analysis);
	if (issues === undefined || issues.length === 0) return 0;

	process.stderr.write(`${input.file_path} has ${issues.length} SonarQube finding(s):\n${describe(issues)}\n`);
	return 2;
}

main().then(
	(code) => process.exit(code),
	() => process.exit(0),
);
