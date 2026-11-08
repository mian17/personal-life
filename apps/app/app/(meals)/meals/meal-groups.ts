import type { MealGroup } from '@/lib/meal-api';

/**
 * The four meal groups in display order (spec: day view), with the label each heading reads.
 *
 * This module is a plain one, deliberately without `'use client'`: the day view is a server
 * component and reads the groups to subtotal the day, while the row island is a client
 * component and reads them to bucket its rows. A constant exported from a `'use client'`
 * module crosses to a server importer as a client reference rather than an array, so the
 * one home both sides can share is a module that is neither.
 */
export const GROUPS: { key: MealGroup; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];
