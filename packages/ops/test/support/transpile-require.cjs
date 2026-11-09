/**
 * The `.ts` loader hook the official-SDK suites spawn their server through
 * (SPEC-ops-agent-contract §3.8, SPEC-mcp-gateway §8 "Success Criteria"): each stdio entry
 * is TypeScript source, and the conformance suites must drive that source with no `dist`
 * build in between, so this hook compiles every loaded `.ts` file with the repo's own
 * `typescript` and hands it to Node in the module format Node itself would give it.
 *
 * That format is the nearest `package.json`'s `type` field, the same walk Node does — not
 * one choice for the whole hook. Both shapes exist in the packages that spawn through
 * here: `packages/ops` declares `"type": "module"`, because `src/mcp/entry.ts` asks
 * `import.meta` whether Node started it, and `import.meta` is a syntax error under a
 * CommonJS transform; `packages/mcp-gateway` declares nothing, stays CommonJS, and its
 * `src` calls `require('../package.json')` and `require.main`, which are `ReferenceError`s
 * under an ES-module transform.
 *
 * Choosing per file is what makes the single hook serve both. A global choice fails one
 * of them at load, the child dies, and the client only sees a closed connection.
 *
 * It writes nothing to stdout: the child's stdout is the JSON-RPC channel, and a stray
 * byte there would end the session.
 */
const { existsSync, readFileSync } = require('node:fs');
const { registerHooks } = require('node:module');
const { dirname, join } = require('node:path');
const typescript = require('typescript');

registerHooks({ resolve: resolveTypeScriptSource, load: loadTranspiledTypeScript });

/**
 * A relative import written for `tsc` names the `.js` file the build emits, which
 * does not exist in `src`; Node's resolver needs the `.ts` sibling instead. An
 * extensionless specifier (jest's CommonJS resolver accepted those) needs one too.
 */
function resolveTypeScriptSource(specifier, context, nextResolve) {
  if (!specifier.startsWith('.')) return nextResolve(specifier, context);
  try {
    return nextResolve(specifier, context);
  } catch {
    return nextResolve(typescriptSourceFor(specifier), context);
  }
}

function typescriptSourceFor(specifier) {
  return specifier.endsWith('.js') ? specifier.replace(/\.js$/, '.ts') : `${specifier}.ts`;
}

function loadTranspiledTypeScript(url, context, nextLoad) {
  if (!isTypeScriptFile(url)) return nextLoad(url, context);
  const format = moduleFormatFor(url);
  return { format, source: transpile(url, format), shortCircuit: true };
}

function isTypeScriptFile(url) {
  return url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/');
}

/** Node's own rule: `"type": "module"` means an ES module, an absent or `"commonjs"` type means CommonJS. */
function moduleFormatFor(url) {
  const { type } = nearestPackageJson(dirname(filePathOf(url))) ?? {};
  return type === 'module' ? 'module' : 'commonjs';
}

/** The first `package.json` above the loaded file, which is the one Node resolves `type` from. */
function nearestPackageJson(directory) {
  const manifest = join(directory, 'package.json');
  if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8'));
  const parent = dirname(directory);
  return parent === directory ? undefined : nearestPackageJson(parent);
}

function filePathOf(url) {
  return new URL(url).pathname;
}

/** Strip-and-transpile only: type checking is `npm run typecheck`'s job, not this hook's. */
function transpile(url, format) {
  const filename = filePathOf(url);
  return typescript.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: format === 'module' ? typescript.ModuleKind.ESNext : typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
}
