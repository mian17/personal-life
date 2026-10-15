# 0029 — An input group carries a visible label and a placeholder; a required-by-the-DB field must read as required in the validator *and* the UX

**Summary:** Every input group renders a visible label and a placeholder; a field the database requires must read as required in the validator and in the UX, because an `aria-label` plus `aria-required` is invisible to the user.

- **Date:** 2026-10-15
- **Source:** user correction — "save in the lesson learned that input group should always have labels and placeholders. If it is required by the database, make sure that the user knows it is required by validator and UX."

## Feedback

> "ui feedback time, save in the lesson learned that input group should always have labels and placeholders. If it is required by the database, make sure that the user knows it is required by validator and UX. Also the buttons and the end of the form are too big, can we make it medium size?"

The feedback submit form shipped every field as an accessible name only:

```tsx
<Input ref={titleRef} aria-label="Title" aria-required maxLength={FEEDBACK_TITLE_MAX} … />
<Textarea ref={descriptionRef} aria-label="Description" aria-required … />
```

No `<label>`, no `placeholder`, and `aria-required` carries no pixels. The only
signal that the fields were mandatory was the error banner after a rejected submit.

This was not an oversight in the implementation — it was a written decision.
`SPEC-feedback-ui.md:143-145` records it:

> **No label primitive for fields** — none needed: `Input` and `Textarea` spread
> native props, and the in-repo precedent is an `aria-label` on the control
> (`recurrence-dialog.tsx` renders `Select aria-label="Frequency"`). No new atom.

The decision optimized for "no new atom" and paid for it in UX. It also confuses
three different things: the accessible name (screen readers), the visible label
(sighted users), and the required signal (both). An `aria-label` supplies only the
first, and the second and third are the ones a person actually sees.

## What it corrected

- **An accessible name is not a visible label.** Lesson 0014 already recorded this
  for the lens chrome; it applies to form fields too. `aria-label="Title"` makes the
  field *announceable* and leaves the form *unlabelled*. A user scanning the dialog
  sees two empty boxes with no captions.
- **`aria-required` is not "the user knows it is required".** The requirement existed
  in three invisible places — the DB (`NOT NULL`), the DTO (`@IsNotEmpty`), and the
  control's accessibility tree — and in zero visible places. "The validator enforces
  it" and "the user knows it" are different claims, and the feedback names both.
- **Validation-as-teaching is a fallback, not the design.** `feedback-form.tsx`
  already carries the comment "the rule is taught by the error, not by an inert
  button", and the ordered validation (title, then description) was deliberate. But
  teaching by error is the *second* line: it costs a failed round trip. The form
  should state its requirements before the user submits, and still enforce them after.
- **`placeholder` is part of the field, not decoration.** It is the one slot that can
  show the shape of the expected input ("Short summary of your feedback") without
  adding copy above the field.
- **A missing primitive is not a reason to skip the requirement.** The original
  decision's premise — "no label primitive exists, therefore none is needed" — inverts
  the repo's Rule 3: when no primitive fits, the primitive is added upstream, not
  routed around.

## The lesson

- **Every input group: visible label + placeholder.** A `<label>` associated with the
  control (via `htmlFor`/`id`) supplies the accessible name *and* the visible caption;
  a `placeholder` shows the expected shape. `aria-label` alone is a regression dressed
  as minimalism — do not ship it as a field's only name.
- **Required-by-the-database means required-in-three-places.** The constraint lives in
  the DB (`NOT NULL`), the validator (DTO / server 400), and the UX (visible required
  marker on the label + `aria-required` on the control). Any of the three missing is a
  defect: the first two protect the data, the third stops the user from discovering the
  rule by failing.
- **Say it before the submit.** A required marker at rest, plus validation on submit —
  never validation alone. "Taught by the error" is the last resort, not the design.
- **Marker text is a design decision, not a bare `*`.** An asterisk with no legend is
  ambiguous to anyone who has not learned the convention; state required explicitly or
  pair the asterisk with a stated convention.

## Applies to

Every form and field in `@life/ui` and every app: the feedback dialog, the recurrence
dialog, tag creation, search fields, the meal editor, and every form built afterward.
The arrow points one way — new fields get label + placeholder + required marker from
the start; existing `aria-label`-only fields are migrations, not templates.
