# Release runbook — tag, push, GitHub release

A release is **a tag plus a GitHub release, on the commit you ship**. Promoting
`dev` to `main` records the release line; it does not tag anything. `v0.2.1`
shipped without a tag and the gap had to be found by hand afterwards, which is
why the procedure is a script and not a memory.

```bash
git switch dev && git pull --ff-only origin dev
# write docs/releases/<version>.md, commit it, land it on dev through a PR
npm run release -- <version>
```

`scripts/release.sh` (`npm run release`) refuses unless all five preconditions
hold, then does the rest in order and proves each half:

| Precondition | Refusal |
|---|---|
| clean tree | `working tree is dirty; commit or stash first` |
| HEAD is `origin/dev` (or `--ref`) | `HEAD is <sha> but origin/dev is <sha>` + hint to pull |
| the tag is new locally and on origin | `v<x> already exists at <sha>` |
| notes file exists and is non-blank | `write the notes first: <path>` |
| every workflow on that exact SHA is `completed`/`success` | the failing workflow names and run URLs |

Then: bump `package.json`'s `version` (one line, `git diff --numstat` must read
`1 1 package.json`), commit as `chore: release v<x>`, annotated tag with the
notes as its message, **land the bump commit through a pull request**, push the
tag, `gh release create`, and the verification prints — local tag SHA, that the
tagged commit is reachable from `origin/dev`, the tag on `origin`, the published
release URL.

The bump commit cannot be pushed to `dev`. The ruleset `Block default branches`
(id 25775908) targets `~DEFAULT_BRANCH` and `refs/heads/main`, requires a pull
request on both, and has no bypass actors, so a direct push is refused with
`GH013: Changes must be made through a pull request.` The script lands it the way
`v0.2.3` landed by hand: branch `chore/release-v<x>` → `gh pr create --base dev`
→ `gh pr merge --merge --subject "chore: release v<x> (#<n>)"` → `git fetch
origin dev` and `git merge-base --is-ancestor HEAD origin/dev`. A **merge commit,
never a squash**: the annotated tag is already created on the bump commit, and a
squash rewrites that SHA, so the tag would name a commit `dev` never had. If the
merge reports the PR is not yet mergeable the script retries once, then stops
with the PR URL so you can merge it yourself.

The notes file must already be committed and on `dev`; an uncommitted one is a
dirty tree, and landing it on `dev` is its own pull request for the same ruleset
reason.

Flags: `--notes <path>`, `--ref <ref>`, `--title <t>`, `--skip-ci-check` (prints
the CI evidence as a warning and continues — deliberate use only, for a release
after a flake), `--dry-run` (preconditions only, then prints every remaining
command; it writes nothing but the one-line `package.json` bump so the diff can
be inspected, and prints the revert), `--help`.

## Notes house style

Read from `v0.2.0` and `v0.1.1`. The script does not generate any of this — it
only consumes the file.

- An opener heading `## v<version> — <short headline>`, or a bare opener
  paragraph naming what the release is. The script takes the first heading as
  the GitHub release title, so the headline has to read on its own.
- A summary line: `**N PRs · M files · +X / −Y.**` — the size, in one glance.
- Sections in prose: *What this release is* / *New* / *Fixed* / *Verification* /
  *Upgrading*. Bold lead-ins, one paragraph per change.
- **Name the actual failure and its cause.** "Every destructive confirm was
  silently dead — `ConfirmButton` armed its latch by disabling the submit button
  during its own click dispatch, so the browser cancelled the default action."
  Never a commit dump, never "various fixes and improvements".
- A closing verification block of gate numbers, as a fenced block:
  suites/tests passed, e2e counts, `typecheck`, `arch:check`, `eslint`, the Sonar
  gate. Numbers, not adjectives.
- *Upgrading* states what a deployment must do — migrations, backups, new
  env names — or says plainly that nothing is needed.

## What the script does not decide

- **What the notes say.** They are written by whoever shipped the change.
- **Whether it is a minor or a patch bump.** The script takes the version you
  give it; the semver judgement is yours.
- **Whether `dev` should be promoted to `main` first.** Promotion is a human
  decision and a separate act; the script tags on `dev` (or `--ref`), and the
  deploy runbook pins no hash because `dev` is the current line.
- **Whether a red CI run is a flake.** `--skip-ci-check` exists so a release can
  still happen, and it prints the evidence it ignored. It is never the default.

The happy path (a real tag, a real push, a real release) can only be proven by a
release. Nothing in CI creates tags.
