// One flat config for the whole monorepo: 19 workspaces sharing a single rule
// set beats 19 configs that drift apart. Type-aware linting is deliberately off
// — `tsc --noEmit` (each workspace's `typecheck` script) owns type correctness,
// and 860+ type-aware files cost minutes per run for no extra signal.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

// Subtrees that render JSX in a browser: the Next app, the pomodoro app, and
// the two UI packages every app composes from.
const reactFiles = [
  'apps/app/**/*.{ts,tsx}',
  'apps/pomodoro/**/*.{ts,tsx}',
  'packages/ui/**/*.{ts,tsx}',
  'packages/app-kit/**/*.{ts,tsx}',
];

// NestJS services and node packages: no DOM.
const nodeFiles = [
  'apps/{note-service,feedback-service,tags-service,todo-service,idp,meal-service,focus-service}/**/*.ts',
  'packages/{shared,cache,crypto,db,nutrition,ops,mcp-gateway,service-kit}/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.tsbuildinfo',
      '**/data/**',
      'docs/**',
      'tasks/**',
      'pictures/**',
      '.pi/**',
      '.unipi/**',
      '.scannerwork/**',
      'vbsec-reports/**',
      'backup/**',
    ],
  },
  js.configs.recommended,
  // The plugin's rules are written for TypeScript: scoping them to `.ts(x)`
  // keeps `.cjs`/`.mjs` build scripts on the plain JS rule set, where `require`
  // is the only module syntax available.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: tsFiles })),
  {
    files: reactFiles,
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Correctness rules from eslint-plugin-react only; the plugin's stylistic
      // half (prop-types, sort-comp, jsx-max-props-per-line) is out of scope for
      // day one, and prop-types is meaningless under TypeScript.
      'react/jsx-key': 'error',
      'react/no-children-prop': 'error',
      'react/no-unknown-property': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // Selected jsx-a11y rules: what a static check can prove about markup we
      // already have. The interaction rules (click-events-have-key-events,
      // no-static-element-interactions) are skipped — they fight the primitives
      // in @life/ui, which implement keyboard behaviour in JS.
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
    },
  },
  {
    files: nodeFiles,
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The Next app has server code (route handlers, auth) beside the browser code.
    files: ['apps/app/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Build and capture scripts, plus the CJS require hook the ops suite spawns.
    files: ['**/*.{js,mjs}', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The screenshot harness drives a page and evaluates code in it.
    files: ['apps/app/test/screens/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The service worker is not the page: `self` and the SW cache APIs only.
    files: ['apps/app/public/sw.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.ts', '**/*.e2e-spec.ts'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
  {
    files: tsFiles,
    rules: {
      // The TS rule is off (see above), so the core rule that typescript-eslint
      // normally shadows would fire on the same sites with no extra signal:
      // 500+ reports, most of them Nest constructor parameters whose
      // parameter-property shorthand looks "unused" to a JS parser.
      'no-unused-vars': 'off',

      // Off, with the findings that forced it (23): every report is a dead import
      // or a dead local in a `test/**` helper (20 of 23) plus three dead bindings
      // in scripts and src. Removing them means editing twenty test files that
      // this change cannot run, which is a bigger risk than the rule is worth on
      // day one. Re-enable once the cleanup lands as its own change.
      '@typescript-eslint/no-unused-vars': 'off',

      // Off, with the finding that forced it: 92 reports, every one in a
      // `test/**` helper that walks an untyped React element tree
      // (`node.props.children`, `jest.spyOn` casts). Typing those needs the
      // per-component prop types the tests deliberately do not depend on, and
      // the rule is type hygiene, not correctness — production `src/**` has no
      // `any` at all.
      '@typescript-eslint/no-explicit-any': 'off',

      // Off, with the findings that forced it (13): `require` is the only load
      // path for the CommonJS test hook (`test/support/transpile-require.cjs`),
      // for a sync re-import inside `jest.isolateModules`, for the non-hoisted
      // `react-dom/server.node` render, and for the package's own `version` read
      // in three `src/` modules (`import` would move that JSON outside
      // `rootDir`). Every alternative changes how those modules load.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The one module where the hook-dependency rule has no honest fix (2
    // findings). `use-timer.ts` restores and persists the saved mode in
    // mount-only effects whose whole point is to read state once — adding
    // `durations` to the restore effect re-runs the restore on every duration
    // change, and the file's own comments explain why that is a bug. The rule
    // stays on everywhere else; the file is not marked in the source because a
    // suppression comment would hide the next real finding in it.
    files: ['apps/pomodoro/src/use-timer.ts'],
    rules: { 'react-hooks/exhaustive-deps': 'off' },
  },
  {
    // The core rule only: `.ts(x)` files keep it off (see above), and it is
    // scoped last so this entry cannot resurrect it for them.
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      // `const { branch, ...rest } = error` drops a key without a dead binding.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    rules: {
      // Comments only, and the one irregular character in the tree is
      // load-bearing: three doc comments spell `apps/*\u200b/data/`, where the
      // zero-width space keeps the `*/` in the path from closing the block
      // comment. Removing it is a parse error, not a cleanup.
      'no-irregular-whitespace': ['error', { skipComments: true }],

      // Off, with the findings that forced it (3): the control-character ranges
      // are the point of the regex at each site — `sanitizeReturnTo` rejects C0
      // controls in a redirect target, and the sonar receiver blanks them out of
      // a log line. Any rewrite (`\p{Cc}`, a code-point scan) widens or narrows
      // what is stripped, which is a behaviour change.
      'no-control-regex': 'off',
    },
  },
);
