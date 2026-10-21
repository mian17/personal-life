import { Pill, Row } from '@life/ui';
import { SESSIONS_PER_CYCLE, type Phase, type Status } from './timer';

export interface SessionPillsProps {
  phase: Phase;
  status: Status;
  session: number;
}

/**
 * Four dots for the cycle, filled for every focus session already behind the timer.
 * A focus fills its dot the moment it ends — at its own `00:00` boundary, not when
 * the break after it is started — because that is the moment the session is behind
 * the timer. A break belongs to the session it follows, so it keeps that dot; the
 * focus after a long break starts the cycle with none.
 *
 * The row is a picture, not a read-out: the dots carry no text, so assistive tech
 * reads the count once, from the label.
 */
export function SessionPills({ phase, status, session }: SessionPillsProps) {
  const completedSessions = completedFocuses(phase, status, session);

  return (
    <Row gap="sm" role="group" aria-label={`Session ${session} of ${SESSIONS_PER_CYCLE}`}>
      {Array.from({ length: SESSIONS_PER_CYCLE }, (_, index) => (
        <Pill key={index} active={index < completedSessions} />
      ))}
    </Row>
  );
}

/** A focus in flight is a session not yet behind the timer; one at its boundary is. */
function completedFocuses(phase: Phase, status: Status, session: number): number {
  if (phase !== 'focus') return session;
  return status === 'boundary' ? session : session - 1;
}
