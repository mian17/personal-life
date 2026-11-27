import { Button, Caption, PageTitle, Screen, StatusText } from '@life/ui';

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
 * The panel carries no `label` because its title is a real heading — a hidden duplicate would give
 * the section two names — and the figure is a result, not a ticking region, so its live region is
 * off (`:111`), while the `minutes sat` line beneath stays plain text.
 */
export function CompleteSitting({ result, onDone }: Readonly<CompleteSittingProps>) {
  return (
    <Screen layout="centred">
      <PageTitle headingLevel="h2" weight="semibold">
        {headlineFor(result)}
      </PageTitle>
      <MinutesFigure minutes={result.minutes} />
      <Caption>minutes sat</Caption>
      <Button shape="pill" size="bare" variant="primary" onClick={onDone}>
        Done
      </Button>
    </Screen>
  );
}

/**
 * The design's `10 min` (`preview/index.html:111`): one display-size line, the number in full ink
 * and its unit in the second tier, so the unit reads as a unit and not as another digit.
 */
function MinutesFigure({ minutes }: Readonly<{ minutes: number }>) {
  return (
    <StatusText aria-live="off" figure size="display">
      {minutes}
      {/* A unit is not a status: the inner line keeps the figure's size and drops the role. */}
      <StatusText aria-live="off" role={undefined} size="display">
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
