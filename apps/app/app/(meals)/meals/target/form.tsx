'use client';

import { useState } from 'react';
import { Button, Input, Section, Select, StatusText } from '@life/ui';
import type { MealTarget } from '@/lib/meal-api';
import { saveProfileAction } from './actions';

/**
 * The target profile form (`SPEC-target-onboarding`). It collects EXACTLY the six
 * profile INPUTS the service stores; the computed kcal/BMR/TDEE/macro grams are
 * derived server-side and must never be sent from the browser ("Never: let the
 * client send computed kcal" — `forbidNonWhitelisted` rejects such a body).
 *
 * Composition is `@life/ui` only (Contract 1 Rule 1): fields are `Input`/`Select`,
 * the block is `Section`, the action is `Button`, feedback is `StatusText`. The
 * `<form>` is glue (submit semantics + native numeric validation), no className,
 * no raw control, no app CSS. Sex/activity/goal are `Select`s over the service
 * enums, so a level the service does not have cannot be offered here.
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

/**
 * The profile form. `initial` is the current target row's stored profile, so an
 * existing profile opens as an edit rather than an empty onboarding form; with no
 * target the fields start on the defaults a first-run user changes at most a few.
 */
export function TargetProfileForm({ initial }: { initial: MealTarget | null }) {
  const [age, setAge] = useState(initial == null ? '' : String(initial.age));
  const [sex, setSex] = useState(initial?.sex ?? 'male');
  const [heightCm, setHeightCm] = useState(initial == null ? '' : String(initial.heightCm));
  const [weightKg, setWeightKg] = useState(initial == null ? '' : String(initial.weightKg));
  const [activity, setActivity] = useState(initial?.activity ?? 'moderate');
  const [goal, setGoal] = useState(initial?.goal ?? 'maintain');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(): Promise<void> {
    // The six profile inputs only (`UpdateProfileDto` minus `date`): computed
    // values (kcal/bmr/tdee/macros) never travel down this path, and `date` is
    // owned by the server action's `getToday()`, not the browser clock.
    const profile = { age: Number(age), sex, heightCm: Number(heightCm), weightKg: Number(weightKg), activity, goal };
    // A blank or non-numeric body field would serialise to `0`/`null` and answer
    // with an opaque 400, so it is caught here; the service DTO owns every bound.
    if ([age, heightCm, weightKg].some((raw) => raw.trim() === '' || !Number.isFinite(Number(raw)))) {
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
    <form
      onSubmit={(event) => {
        event.preventDefault();
        return save();
      }}
    >
      <Section label={initial == null ? 'Set your target' : 'Update your profile'}>
        <Input
          aria-label="Age"
          type="number"
          min={1}
          max={130}
          required
          value={age}
          onChange={(event) => setAge(event.target.value)}
        />
        <Select
          aria-label="Sex"
          value={sex}
          options={SEX_OPTIONS}
          onChange={(event) => setSex(event.target.value)}
        />
        <Input
          aria-label="Height (cm)"
          type="number"
          min={50}
          max={260}
          required
          value={heightCm}
          onChange={(event) => setHeightCm(event.target.value)}
        />
        <Input
          aria-label="Weight (kg)"
          type="number"
          min={20}
          max={500}
          required
          value={weightKg}
          onChange={(event) => setWeightKg(event.target.value)}
        />
        <Select
          aria-label="Activity"
          value={activity}
          options={ACTIVITY_OPTIONS}
          onChange={(event) => setActivity(event.target.value)}
        />
        <Select
          aria-label="Goal"
          value={goal}
          options={GOAL_OPTIONS}
          onChange={(event) => setGoal(event.target.value)}
        />
        {error !== '' ? <StatusText>{error}</StatusText> : null}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Set target'}
        </Button>
      </Section>
    </form>
  );
}
