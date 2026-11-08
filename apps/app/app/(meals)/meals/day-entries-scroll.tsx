'use client';

import { useState } from 'react';
import { AlertBanner, EmptyState, List, ListItem, LoadMore, Pill, Section } from '@life/ui';
import type { MealGroup } from '@/lib/meal-api';

/**
 * One day-view row as the server sends it: which meal it belongs to, the dish name already
 * resolved through the catalog, the portion, and the calorie figure already formatted.
 * `@life/nutrition` and the catalog stay out of the browser bundle, so an appended page is
 * built on the server too and crosses as plain strings (the `CatalogRow` precedent).
 *
 * `mealGroup` crosses as the stored key, not a bucket: the shell re-derives the per-group
 * slices from the merged rows on every append, so a breakfast row arriving on page 2 still
 * lands under Breakfast rather than in a second, appended breakfast group.
 */
export interface DayEntryRow {
  id: string;
  mealGroup: MealGroup;
  /** The dish name, or the calorie figure when the stored name is blank. */
  title: string;
  /** `× 2` — the portion, as the row's sub-line. */
  meta: string;
  /** The calorie pill; `null` when `title` already is that figure. */
  pill: string | null;
}

/** One page of rows plus the cursor that continues it. */
export interface DayEntriesPage {
  rows: DayEntryRow[];
  nextCursor: string | null;
}

/**
 * One meal's figures over the **whole day** — never over the rows loaded so far. The server
 * computes them from `collectDayEntries`, which it already reads for the headline, so a
 * subtotal can never become a partial figure as pages append (criterion 4 applies to the
 * groups the same way it applies to the headline).
 */
export interface MealGroupSummary {
  /** The group's calorie subtotal, formatted; `null` when the whole day has no entry in it. */
  calories: string | null;
}

/** The four meal groups in display order (spec: day view). */
export const GROUPS: { key: MealGroup; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];

/**
 * A group with nothing logged keeps its heading, so the day always shows the four meals it is
 * made of: the count slot reads the literal `Not logged` where a group with entries reads its
 * subtotal, and the group's box carries this copy instead of a list.
 */
const EMPTY_GROUP_COUNT = 'Not logged';
const EMPTY_GROUP_BODY = 'No meals logged in this meal yet.';
const EMPTY_GROUP_HEADING = 'Nothing yet.';

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more of this day. Try again.";

/**
 * What one press of the control leaves behind. A failed page changes neither the rows nor the
 * cursor — the banner alone reports it — so the control re-arms and the same cursor is asked for
 * again; nothing already on screen is lost.
 */
export type AppendOutcome =
  | { loaded: true; rows: DayEntryRow[]; cursor: string | null }
  | { loaded: false };

/** The page after `cursor`, merged onto the rows in hand. It is a plain function, not the island's
 * own body, so the append and its failure rule are testable without a DOM. */
export async function appendNextPage(
  cursor: string,
  loadPage: (cursor: string) => Promise<DayEntriesPage>,
  current: DayEntryRow[],
): Promise<AppendOutcome> {
  try {
    const page = await loadPage(cursor);
    return { loaded: true, rows: [...current, ...page.rows], cursor: page.nextCursor };
  } catch {
    return { loaded: false };
  }
}

/**
 * The merged rows bucketed into the four meals, in `GROUPS` order. It runs on every render over
 * the whole merged set, so an appended row lands in the meal it belongs to even when that meal is
 * already on screen — a group is a slice of what is in hand, never a chunk of a page.
 */
export function groupedRows(
  rows: DayEntryRow[],
): { group: (typeof GROUPS)[number]; items: DayEntryRow[] }[] {
  return GROUPS.map((group) => ({
    group,
    items: rows.filter((row) => row.mealGroup === group.key),
  }));
}

/**
 * The day's rows and the control that adds a page to them (`SPEC-load-more`). Page 1 arrives
 * server-rendered, so the screen opens on exactly the rows it always did; this holds only what
 * more pages add — the appended rows, the cursor they continue from, and the one message a
 * failure raises.
 *
 * The rows are held merged and the groups are re-derived from that merge, so an appended row
 * re-buckets into the meal it belongs to even when that meal is already on screen, and group
 * order stays `GROUPS`' order rather than arrival order. The headlines are not this island's:
 * the calorie total, the read-out and the energy track are computed on the server from the
 * complete day, so appending a page cannot move them.
 */
export function DayEntriesScroll({
  rows: firstPage,
  nextCursor: firstCursor,
  groups,
  loadPage,
}: Readonly<{
  /** Page 1, server-rendered. */
  rows: DayEntryRow[];
  /** Where page 1 ends; `null` is the whole day, and no load-more control renders. */
  nextCursor: string | null;
  /** Every group's whole-day subtotal — the complete day, not the loaded rows. */
  groups: Record<MealGroup, MealGroupSummary>;
  /** Fetch the page after `cursor`, rows built before they cross — a server action. */
  loadPage: (cursor: string) => Promise<DayEntriesPage>;
}>) {
  const [appended, setAppended] = useState<DayEntryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    const outcome = await appendNextPage(cursor, loadPage, appended);
    if (!outcome.loaded) {
      // The rows on screen are still valid; only the next page failed. `LoadMore`
      // re-arms itself and this line says why nothing was added.
      setFailure(LOAD_FAILURE);
      return;
    }
    setAppended(outcome.rows);
    setCursor(outcome.cursor);
    setFailure(null);
  }

  return (
    <>
      {failure != null && <AlertBanner>{failure}</AlertBanner>}
      {groupedRows(rows).map(({ group, items }) => (
        <MealGroup key={group.key} group={group} items={items} summary={groups[group.key]} />
      ))}
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}

/**
 * One meal of the day: its heading with the whole-day subtotal (or `Not logged`), then the
 * rows logged in it that are loaded so far.
 */
function MealGroup({
  group,
  items,
  summary,
}: Readonly<{
  group: { key: MealGroup; label: string };
  items: DayEntryRow[];
  summary: MealGroupSummary;
}>) {
  return (
    <Section label={group.label} count={summary.calories ?? EMPTY_GROUP_COUNT}>
      {groupBody(items, summary)}
    </Section>
  );
}

/**
 * The group's body, from the rows in hand. A group whose entries all sit on a page not loaded
 * yet draws nothing rather than the empty box — its copy says nothing was logged in this meal,
 * and the heading's subtotal already reports the meal's exact figure.
 */
function groupBody(items: DayEntryRow[], summary: MealGroupSummary) {
  if (items.length === 0) {
    return summary.calories === null ? (
      <EmptyState heading={EMPTY_GROUP_HEADING} body={EMPTY_GROUP_BODY} />
    ) : null;
  }

  return (
    <List>
      {items.map((row) => (
        <ListItem
          key={row.id}
          title={row.title}
          meta={row.meta}
          trailing={row.pill != null ? <Pill>{row.pill}</Pill> : undefined}
        />
      ))}
    </List>
  );
}
