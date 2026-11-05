'use client';

import { useState } from 'react';
import { format } from '@life/nutrition';
import {
  Button,
  Card,
  Facts,
  FactsRow,
  Input,
  Kpi,
  PageShell,
  PageTitle,
  Pill,
  Section,
  Select,
  SettingsBlock,
  SettingsRow,
  Stack,
  StatusText,
  SubNav,
} from '@life/ui';
import type { MealTarget } from '@/lib/meal-api';
import { saveProfileAction } from './actions';

/**
 * The target profile form (`SPEC-target-onboarding`). It collects EXACTLY the six
 * profile INPUTS the service stores; the computed kcal/BMR/TDEE/macro grams are
 * derived server-side and must never be sent from the browser ("Never: let the
 * client send computed kcal" — `forbidNonWhitelisted` rejects such a body).
 *
 * Composition is `@life/ui` only (Contract 1 Rule 1): the frame is `PageShell`,
 * the header is the reference's sub-view row (`SubNav` back to settings) over
 * `PageTitle` and its server-computed sub-line, each field is a `SettingsRow`
 * (visible label left, control right) hosting an `Input`/`Select` on the
 * reference's shared surface group (`SettingsBlock`, a flush `Card` of
 * hairline-divided rows), feedback is `StatusText` outside that card, and the one
 * commit affordance is the footer's primary submit `Button`. The derived-energy
 * card and the `Profile` read-out rows are the reference's read-only half; the
 * form below them is the only place a value changes. The `<form>` is glue (submit
 * semantics + native numeric validation), no className, no raw control, no app
 * CSS. Sex/activity/goal are `Select`s over the service enums, so a level the
 * service does not have cannot be offered here.
 */

/** `SEXES` in the service's `target-calculator.ts`. */
const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

/** `ACTIVITY_LEVELS` in the service's `target-calculator.ts`. */
const ACTIVITY_OPTIONS = [
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active' },
  { value: 'veryActive', label: 'Very active' },
];

/** `GOALS` in the service's `target.ts`. */
const GOAL_OPTIONS = [
  { value: 'lose', label: 'Lose weight' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Gain weight' },
];

/** Whole kcal with the reference's thousands separator (`2,050`); the formatter does not group. */
const KCAL = new Intl.NumberFormat('en-US');

/** The stored enum value as its own option list spells it (the service owns the vocabulary). */
function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * The profile form. `initial` is the current target row's stored profile, so an
 * existing profile opens as an edit rather than an empty onboarding form; with no
 * target the fields start on the defaults a first-run user changes at most a few.
 * `summary` is the day's derived-calorie headline the server page computed — it
 * is non-null exactly when a target exists, which is the same condition that
 * draws the derived-energy card, so the card replaces the sentence and the
 * figures are never printed twice.
 */
export function TargetProfileForm({
  initial,
  summary,
}: Readonly<{
  initial: MealTarget | null;
  summary?: string | null;
}>) {
  const [age, setAge] = useState(initial == null ? '' : String(initial.age));
  const [sex, setSex] = useState(initial?.sex ?? 'male');
  const [heightCm, setHeightCm] = useState(initial == null ? '' : String(initial.heightCm));
  const [weightKg, setWeightKg] = useState(initial == null ? '' : String(initial.weightKg));
  const [activity, setActivity] = useState(initial?.activity ?? 'moderate');
  const [goal, setGoal] = useState(initial?.goal ?? 'maintain');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A blank or non-numeric body field would serialise to `0`/`null` and answer
  // with an opaque 400, so the footer commit stays disabled until the numerics
  // parse; the service DTO owns every bound.
  const profileReady = [age, heightCm, weightKg].every(
    (raw) => raw.trim() !== '' && Number.isFinite(Number(raw)),
  );

  async function save(): Promise<void> {
    // The six profile inputs only (`UpdateProfileDto` minus `date`): computed
    // values (kcal/bmr/tdee/macros) never travel down this path, and `date` is
    // owned by the server action's `getToday()`, not the browser clock.
    const profile = { age: Number(age), sex, heightCm: Number(heightCm), weightKg: Number(weightKg), activity, goal };
    if (!profileReady) {
      setError('Enter your age, height and weight as numbers.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveProfileAction(profile);
    } catch {
      setError('Could not save the profile. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <SubNav backHref="/meals/settings" backLabel="Meals" />

      <PageTitle sub="Computed on the server from these six values. Nothing here is guessed in the browser.">
        Daily target
      </PageTitle>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          return save();
        }}
      >
        {initial != null && summary != null ? (
          <>
            <Card>
              <Stack gap="sm">
                <Kpi
                  label="Derived energy"
                  value={KCAL.format(Math.round(initial.calories))}
                  unit="kcal"
                />
                <Facts>
                  <FactsRow label="Protein" value={format('protein', initial.proteinG)} />
                  <FactsRow label="Carbs" value={format('carbohydrates', initial.carbG)} />
                  <FactsRow label="Fat" value={format('fat', initial.fatG)} />
                </Facts>
              </Stack>
            </Card>
            <SettingsBlock title="Profile">
              <SettingsRow label="Age" control={<Pill>{`${initial.age} years`}</Pill>} />
              <SettingsRow label="Height" control={<Pill>{`${initial.heightCm} cm`}</Pill>} />
              <SettingsRow label="Weight" control={<Pill>{`${initial.weightKg} kg`}</Pill>} />
              <SettingsRow label="Sex" control={<Pill>{optionLabel(SEX_OPTIONS, initial.sex)}</Pill>} />
              <SettingsRow
                label="Activity"
                control={<Pill>{optionLabel(ACTIVITY_OPTIONS, initial.activity)}</Pill>}
              />
              <SettingsRow label="Goal" control={<Pill>{optionLabel(GOAL_OPTIONS, initial.goal)}</Pill>} />
            </SettingsBlock>
          </>
        ) : (
          <StatusText>No target set yet — add your profile below.</StatusText>
        )}
        <SettingsBlock title={initial == null ? 'Set your target' : 'Update your profile'}>
          <SettingsRow
            label="Age"
            control={
              <Input
                aria-label="Age"
                type="number"
                min={1}
                max={130}
                required
                value={age}
                onChange={(event) => setAge(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Sex"
            control={
              <Select
                aria-label="Sex"
                value={sex}
                options={SEX_OPTIONS}
                onChange={(event) => setSex(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Height (cm)"
            control={
              <Input
                aria-label="Height (cm)"
                type="number"
                min={50}
                max={260}
                required
                value={heightCm}
                onChange={(event) => setHeightCm(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Weight (kg)"
            control={
              <Input
                aria-label="Weight (kg)"
                type="number"
                min={20}
                max={500}
                required
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Activity"
            control={
              <Select
                aria-label="Activity"
                value={activity}
                options={ACTIVITY_OPTIONS}
                onChange={(event) => setActivity(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Goal"
            control={
              <Select
                aria-label="Goal"
                value={goal}
                options={GOAL_OPTIONS}
                onChange={(event) => setGoal(event.target.value)}
              />
            }
          />
        </SettingsBlock>
        {/* Outside the card: the feedback is not one of the profile's rows, so it must
            not read as a seventh bordered group row. */}
        {error !== '' ? <StatusText>{error}</StatusText> : null}
        {/* The footer is the screen's only commit affordance (reference `.subfoot`); a
            label-less `Section` gives it the same `--s6` step the body's groups open with. */}
        <Section>
          <Button type="submit" disabled={saving || !profileReady}>
            Update profile
          </Button>
        </Section>
      </form>
    </PageShell>
  );
}
