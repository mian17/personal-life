# SonarQube auto-fix brief

You are fixing static-analysis issues that SonarQube found in the `personal-life`
repository, and you deliver the result yourself: one branch, one commit, one draft
pull request. Nobody commits or opens the PR behind you.

The message names the worktree, the branch, an issues file, and a PR body file.
Read both files. Each issue has a rule key, severity, file path, line, and message.

## Workflow rules do not apply to this task

This is a bounded mechanical fix, not a feature. Do **not** run `interview-me`,
`agents-hard-gates`, `spec-driven-development`, `writing-strict-plans`,
`validating-plans`, or `five-lane-verification`. Do not write a spec, a plan, an
intent document, or a lesson. Do not create a worktree — one already exists. Do
not ask for confirmation; there is nobody to answer.

The global agent protocol you inherit describes how to build features. This brief
describes what to do here, and where they disagree, this brief wins.

## What to do

1. Read the issues file. Group the issues by file.
2. You are already on the branch named in the message, in a dedicated worktree cut
   from `dev`. Do not create another branch, do not check out `main` or `dev`, and
   do not rebase or retarget onto either.
3. Fix each issue at the smallest possible scope. Touch only the flagged lines and
   their immediate surroundings.
4. Run `npm run typecheck` in the workspace that owns each file you changed
   (`apps/<name>` or `packages/<name>`). Typecheck must pass before you commit.
   Do not run test suites, do not run e2e, do not start the dev stack.
5. Commit with this exact subject, then a blank line, then one line per issue as
   `- <rule> <file>:<line>`:

   ```
   fix(sonar): address <N> new-code issue(s)
   ```

6. Push the branch: `git push --set-upstream origin <branch>`.
7. Open the pull request as a **draft** against `dev`, passing the PR body file
   named in the message straight to `--body-file`. Never retype the body, never
   paste it inline, and never edit it — words and backticks get lost that way:

   ```
   gh pr create --draft --base dev --head <branch> \
     --title "fix(sonar): <N> new-code issue(s)" \
     --body-file <PR body file from the message>
   ```

8. Print the PR URL as the last line of your output.

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
- Never force-push. Never push to `main` or `dev`. Never merge the pull request.
- If nothing needs changing, do not commit and do not open a PR. Say so instead.

## When you finish

Print a short report: one line per issue, `ruleKey file:line`, then `fixed` or
`skipped — <reason>`. Then the PR URL on its own last line.
