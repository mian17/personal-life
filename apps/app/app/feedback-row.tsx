'use client';

import { useRef, useState } from 'react';
import type { FeedbackDto, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import {
  AlertBanner,
  feedbackStatusOption,
  FEEDBACK_STATUSES,
  ListItem,
  LocalTime,
  Pill,
  Select,
} from '@life/ui';

/** The dropdown's choices: the same vocabulary, and the only place a `Select` needs building. */
const STATUS_OPTIONS = FEEDBACK_STATUSES.map(({ value, label }) => ({ value, label }));

/**
 * One feedback row: the status pill rides the title line (`titleAction`) and the
 * status dropdown stacks beneath the text (`children`) — both are
 * `ListItem variant="feedback"` slots, so the app passes data, never markup. The
 * pill's `tone` is the vocabulary value; `atoms.css` maps it to the status's
 * semantic token, and `tokens.test.ts` pins that mapping against `tokens.css`.
 *
 * The only client island on `/feedback` (the `todo-item.tsx` precedent): the
 * dropdown writes through the server action the inbox hands it, so `ListShell`
 * and the rest of the inbox stay server-rendered.
 */
export function FeedbackRow({
  entry,
  setStatusAction,
}: Readonly<{
  entry: FeedbackDto;
  setStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}>) {
  const { label } = feedbackStatusOption(entry.status);
  /**
   * `picked` is the value in flight: while the write is pending the dropdown
   * shows the user's choice (`pickStatus` sets it synchronously); once the
   * seam answers we drop it so the dropdown follows the row's pill again (on
   * success via the re-rendered `entry.status`, on failure we keep the old
   * value and surface the failure message the seam documents).
   */
  const [picked, setPicked] = useState<FeedbackStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Every pick takes the next ticket, and only the newest ticket may settle the
   * row: a slower earlier `PATCH` must not clear the dropdown or raise its banner
   * over the result of the pick the user made after it.
   */
  const pickTicket = useRef(0);

  function pickStatus(status: FeedbackStatus) {
    const ticket = ++pickTicket.current;
    setPicked(status);
    setFailure(null);
    void setStatusAction(entry.id, status).then((result) => {
      if (ticket !== pickTicket.current) return;
      setPicked(null);
      if (!result.ok) {
        setFailure(result.message);
      }
    });
  }

  return (
    <ListItem
      variant="feedback"
      title={entry.title}
      snippet={entry.description}
      meta={<LocalTime dateTime={entry.createdAt} />}
      titleAction={
        <Pill tone={entry.status}>{label}</Pill>
      }
    >
      <Select
        aria-label={`Set status for ${entry.title}`}
        value={picked ?? entry.status}
        onChange={(event) => pickStatus(event.target.value as FeedbackStatus)}
        options={STATUS_OPTIONS}
      />
      {failure != null && <AlertBanner role="alert">{failure}</AlertBanner>}
    </ListItem>
  );
}
