# SonarQube auto-fix brief

You are fixing static-analysis issues that SonarQube found in the `personal-life`
repository. The issues are in the JSON file named in the message. Each entry has a
rule key, severity, file path, line, and message.

## What to do

1. Read every issue in the file. Group them by file.
2. Fix each issue at the smallest possible scope. Touch only the flagged lines and
   their immediate surroundings.
3. After editing, run `npm run typecheck` in the workspace that owns the file you
   changed (`apps/<name>` or `packages/<name>`). Typecheck must pass before you
   stop. Do not run test suites, do not run e2e, do not start the dev stack.
4. Leave the working tree with your edits in place. Do not commit, do not push,
   do not create a branch. The receiver outside the sandbox does that.

## Constraints

- Fix only the listed issues. Do not refactor, rename, reformat, or "clean up"
  anything else. An unrelated diff will be rejected.
- No new dependencies.
- Code must read as prose: intention-revealing names, small single-purpose
  functions, top-to-bottom narrative flow.
- Never weaken a check to silence an issue. No `@ts-ignore`, no `eslint-disable`,
  no deleting or skipping a test, no lowering a threshold. If an issue cannot be
  fixed correctly, leave it and say why.
- Frozen surfaces are off limits: e2e selector text and roles, token values in
  `packages/ui/test/tokens.test.ts`, PWA manifest constants.
- UI code composes `@life/ui` primitives. Never add bare `<button>`, `<input>`,
  `<textarea>`, `<select>`, `<a>`, `<img>`, `<label>`, or `<progress>` to `apps/*`.

## When you finish

Print a short report: one line per issue, `ruleKey file:line`, then `fixed` or
`skipped — <reason>`. Nothing else.
