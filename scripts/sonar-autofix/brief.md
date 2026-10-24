# SonarQube auto-fix brief

You are fixing static-analysis issues that SonarQube found in the `personal-life`
repository, and you deliver the result yourself: one branch, one commit, one draft
pull request. Nobody commits or opens the PR behind you.

The message names three things: the branch to work on, a JSON file listing the
issues, and a markdown file holding the PR body. Each issue has a rule key,
severity, file path, line, and message.

## What to do

1. Read every issue. Group them by file.
2. You are already on the branch named in the message, in a dedicated worktree, cut
   from the integration branch. Do not create another branch, do not check out
   `main`, and do not rebase onto `main`.
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
7. Open the pull request as a **draft** against the target branch named in the
   message (`dev`, not `main`), using the body file verbatim:

   ```
   gh pr create --draft --base <target branch> --head <branch> \
     --title "fix(sonar): <N> new-code issue(s)" \
     --body-file <pr body path>
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
- Never force-push. Never push to `main` or to the integration branch. Never merge
  the pull request.
- If nothing needs changing, do not commit and do not open a PR. Say so instead.

## When you finish

Print a short report: one line per issue, `ruleKey file:line`, then `fixed` or
`skipped — <reason>`. Then the PR URL on its own last line.
