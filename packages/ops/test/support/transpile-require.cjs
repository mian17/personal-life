/**
 * The `.ts` require hook the official-SDK suite spawns its server through
 * (SPEC-ops-agent-contract §3.8): the stdio entry is TypeScript source, and the
 * conformance suite must drive that source with no `dist` build in between, so
 * this hook compiles every loaded `.ts` file with the repo's own `typescript`
 * and hands it to Node as CommonJS.
 *
 * It writes nothing to stdout: the child's stdout is the JSON-RPC channel, and a
 * stray byte there would end the session.
 */
const { readFileSync } = require('node:fs');
const { registerHooks } = require('node:module');
const typescript = require('typescript');

registerHooks({ resolve: resolveTypeScriptSibling, load: loadTranspiledTypeScript });

/** A relative import written for `tsc` omits its extension; Node's resolver needs one. */
function resolveTypeScriptSibling(specifier, context, nextResolve) {
  if (!specifier.startsWith('.')) return nextResolve(specifier, context);
  try {
    return nextResolve(specifier, context);
  } catch {
    return nextResolve(`${specifier}.ts`, context);
  }
}

function loadTranspiledTypeScript(url, context, nextLoad) {
  if (!isTypeScriptFile(url)) return nextLoad(url, context);
  return { format: 'commonjs', source: transpile(url), shortCircuit: true };
}

function isTypeScriptFile(url) {
  return url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/');
}

/** Strip-and-transpile only: type checking is `npm run typecheck`'s job, not this hook's. */
function transpile(url) {
  const filename = new URL(url).pathname;
  return typescript.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
}
