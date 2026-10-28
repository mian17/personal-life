# Task List: shadcn/ui primitive migration for `@life/ui`

*Task list target for the planning-and-task-breakdown run. Each line is one of the 41 tasks in
`tasks/plan.md`, which holds the full task structure (description, acceptance criteria,
verification, dependencies, files, scope). Checkpoints are the phase gates from `tasks/plan.md`
Step 5; a task is checked only when its own verification block is green.*

> Task boxes here mirror `tasks/plan.md` and are not a ticked execution log; the
> evidence of record is the §8 gate output in
> `docs/reports/shadcn-primitive-migration-2026-10-28.md`.

### Phase 0 — Gate
- [x] Task 1: Record the maintainer's rulings (ledger settled 2026-10-27: PostCSS config,
      `cmdk`, selector surface revoked, stylesheet-reading assertions deletable, `tab-bar` swapped)
### Phase 1 — Foundation and first vertical slice
- [ ] Task 2: Stand up the Tailwind v4 theme pipeline (theme + utilities layers, preflight off)
- [ ] Task 3: Pin the vendored shadcn snapshot record
- [ ] Task 4: Convert Button and IconButton from the registry copy
- [ ] Task 5: Prove colour parity with computed-style assertions
- [ ] Task 6: Convert ButtonLink and IconLink
### Phase 2 — Form controls
- [ ] Task 7: Convert Input and Textarea
- [ ] Task 8: Convert Checkbox and Switch
- [ ] Task 9: Convert Select to the native-select recipe
- [ ] Task 10: Convert SearchField and CreateField
- [ ] Task 11: Convert FilePicker
- [ ] Task 12: Convert StatusText and LocalTime
### Phase 3 — Chips and surfaces
- [ ] Task 13: Convert Pill
- [ ] Task 14: Convert PillGroup and TagFilterNav
- [ ] Task 15: Convert DueDatePill and DueDate
- [ ] Task 16: Convert Card
- [ ] Task 17: Convert AlertBanner and EmptyState
### Phase 4 — Overlays and stateful controls
- [ ] Task 18: Convert Dialog to the Radix dialog
- [ ] Task 19: Convert Menu to the Radix dropdown
- [ ] Task 20: Convert TabBar and Tab to the Radix `tabs` source
- [ ] Task 21: Convert Snackbar and SnackbarProvider
- [ ] Task 22: Convert ThemeToggle and ConfirmButton
- [ ] Task 23: Convert Autosuggest to the combobox recipe (`cmdk`)
- [ ] Task 24: Convert FeedbackForm and FeedbackNavItem
### Phase 5 — Layout atoms and structure
- [ ] Task 25: Convert Stack, Row and EditorStack
- [ ] Task 26: Convert Section and PageActions
- [ ] Task 27: Convert PageTitle
- [ ] Task 28: Convert NavBar and FabLink
- [ ] Task 29: Convert List and ListShell
- [ ] Task 30: Convert ListItem
- [ ] Task 31: Convert SettingsRow and SettingsBlock
- [ ] Task 32: Convert ManagerSurface and ManagerBlock
- [ ] Task 33: Convert TagManager
- [ ] Task 34: Convert ListManager
- [ ] Task 35: Convert MatrixBlock and EditorToolbar
- [ ] Task 36: Convert EditorScreen
### Phase 6 — Out-of-scope blocks (restyle pass)
- [ ] Task 37: Restyle PageShell and EditorChrome
- [ ] Task 38: Restyle FabMenu and TagPicker
- [ ] Task 39: Restyle TrashBlock
### Phase 7 — Close
- [ ] Task 40: Delete `atoms.css` and `blocks.css`
- [ ] Task 41: Run the close-out gate
