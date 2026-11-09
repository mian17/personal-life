/**
 * The `.ts` loader hook the official-SDK suite spawns its server through
 * (SPEC-ops-agent-contract §3.8): the stdio entry is TypeScript source, and the
 * conformance suite must drive that source with no `dist` build in between, so
 * this hook compiles every loaded `.ts` file with the repo's own `typescript`
 * and hands it to Node as an ES module.
 *
 * ES module, not CommonJS: the entry in `src/mcp/entry.ts` uses `import.meta` to
 * ask whether Node started it, and `import.meta` is a syntax error under a
 * CommonJS transform. The package itself now emits ES modules, so this is the
 * shape the compiled code will run in anyway.
 *
 * It writes nothing to stdout: the child's stdout is the JSON-RPC channel, and a
 * stray byte there would end the session.
 */
const { readFileSync } = require('node:fs');
const { registerHooks } = require('node:module');
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
  return { format: 'module', source: transpile(url), shortCircuit: true };
}

function isTypeScriptFile(url) {
  return url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/');
}

/** Strip-and-transpile only: type checking is `npm run typecheck`'s job, not this hook's. */
function transpile(url) {
  const filename = new URL(url).pathname;
  return typescript.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
}
