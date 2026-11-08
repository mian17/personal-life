import { cx, Pill, Row } from '@life/ui';
import { SESSIONS_PER_CYCLE, type Phase, type Status } from './timer';

export interface SessionPillsProps {
  phase: Phase;
  status: Status;
  session: number;
  className?: string;
}

/**
 * Four dots for the cycle, filled for every focus session already behind the timer.
 * A focus fills its dot the moment it ends — at its own `00:00` boundary, not when
 * the break after it is started — because that is the moment the session is behind
 * the timer. A break belongs to the session it follows, so it keeps that dot; the
 * focus after a long break starts the cycle with none.
 *
 * The row is a picture, not a read-out: the dots carry no text, so assistive tech
 * reads the count once, from the label — hence `role="img"`, which is the reference's
 * own role for its `.dots` row.
 */
export function SessionPills({
  phase,
  status,
  session,
  className,
}: Readonly<SessionPillsProps>) {
  const completedSessions = completedFocuses(phase, status, session);

  return (
    <Row className={className} role="img" aria-label={`Session ${session} of ${SESSIONS_PER_CYCLE}`}>
      {Array.from({ length: SESSIONS_PER_CYCLE }, (_, index) => {
        const filled = index < completedSessions;
        return (
          // §8's `.dot` is an 8px ring on the strong hairline, filled with the accent
          // once its session is behind the timer. The pill keeps its radius and its
          // two-state fill and drops the chip's tap floor, inset and neutral tint,
          // which are what make it a chip rather than a dot.
          <Pill
            key={index}
            active={filled}
            className={cx(
              'size-[var(--s2)]! min-h-0! p-0! border-[length:var(--border-width-strong)]!',
              !filled && 'border-line-strong! bg-transparent!',
            )}
          />
        );
      })}
    </Row>
  );
}

/** A focus in flight is a session not yet behind the timer; one at its boundary is. */
export function completedFocuses(phase: Phase, status: Status, session: number): number {
  if (phase !== 'focus') return session;
  return status === 'boundary' ? session : session - 1;
}
