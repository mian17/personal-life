import { Button, Caption, PageTitle, StatusText } from '@life/ui';

/** What a recorded sitting left behind: the minutes it counts, and whether it ran its whole plan. */
export interface SittingResult {
  minutes: number;
  completed: boolean;
}

export interface CompleteSittingProps {
  result: SittingResult;
  /** Back to idle with a freshly read day: the sitting that just ended has to show in it. */
  onDone: () => void;
}

/**
 * The complete panel (`SPEC-ui-meditation-primitives` §1, §4, §11, §13): the design's title, the
 * figure it recorded, the line that names the figure, and the one way out.
 *
 * The section carries no `aria-label` because its title is a real heading — a second name would give
 * it two — and the figure is a result, not a ticking region, so its live region is off (`:111`),
 * while the `minutes sat` line beneath stays plain text.
 */
export function CompleteSitting({ result, onDone }: Readonly<CompleteSittingProps>) {
  return (
    <section className="flex flex-col items-center justify-center gap-[var(--s6)] py-[var(--s8)] text-center">
      <PageTitle headingLevel="h2" weight="semibold">
        {headlineFor(result)}
      </PageTitle>
      <MinutesFigure minutes={result.minutes} />
      <Caption>minutes sat</Caption>
      <Button size="bare" variant="primary" onClick={onDone}>
        Done
      </Button>
    </section>
  );
}

/**
 * The design's `10 min` (`preview/index.html:111`): one display-size line in the full ink, the unit
 * riding the same figure as the digits rather than dropping to the second tier beside it.
 */
function MinutesFigure({ minutes }: Readonly<{ minutes: number }>) {
  return (
    <StatusText aria-live="off" figure size="display">
      {minutes}
      {/* A unit is not a status: the inner line keeps the figure's face and drops the role. */}
      <StatusText aria-live="off" figure role={undefined} size="display">
        {' min'}
      </StatusText>
    </StatusText>
  );
}

/**
 * The heading the recorded minutes earned. The design has one screen, whose title is a claim about
 * the sitting; a sitting stopped early did not run its plan, so its heading says what happened
 * instead, in the confirm sheet's own words, over the minutes it actually kept.
 */
function headlineFor(result: SittingResult): string {
  return result.completed ? 'Session complete' : 'Session ended early';
}
