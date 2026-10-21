import { Pill, Row } from '@life/ui';
import { SESSIONS_PER_CYCLE, type Phase } from './timer';

export interface SessionPillsProps {
  phase: Phase;
  session: number;
}

/**
 * Four dots for the cycle, filled for every focus session already behind the timer.
 * A break belongs to the session it follows, so it keeps that session's dots filled;
 * the focus after a long break starts the cycle with none.
 *
 * The row is a picture, not a read-out: the dots carry no text, so assistive tech
 * reads the count once, from the label.
 */
export function SessionPills({ phase, session }: SessionPillsProps) {
  const completedSessions = phase === 'focus' ? session - 1 : session;

  return (
    <Row gap="sm" role="group" aria-label={`Session ${session} of ${SESSIONS_PER_CYCLE}`}>
      {Array.from({ length: SESSIONS_PER_CYCLE }, (_, index) => (
        <Pill key={index} active={index < completedSessions} />
      ))}
    </Row>
  );
}
