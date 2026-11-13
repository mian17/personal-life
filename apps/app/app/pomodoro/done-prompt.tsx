'use client';

import { useState, useTransition } from 'react';
import { Button, Dialog } from '@life/ui';
import { answerFocusQuestionAction } from './actions';

/** A recorded block whose task raised the question this prompt asks. */
export interface FocusQuestion {
  /** The session the answer is written against — the record, not the task. */
  sessionId: string;
  /** The task the block worked on. */
  todoId: string;
  /** What the block counted, so the question reads as a question about a real block. */
  minutes: number;
  /** The task's title, for the sentence. The task itself is read, never copied into the row. */
  title: string;
}

export interface DonePromptProps {
  /** The question still owed, or `null` when there is none. */
  question: FocusQuestion | null;
  /** Told after either answer is written, so the caller stops holding the question. */
  onAnswered: () => void;
}

/**
 * The "done?" question a task-linked block asks, at both moments a block is recorded and
 * on the next load when the tab closed before it was answered.
 *
 * Both answers are answers: `Done` ticks the task through the owner's own
 * `PATCH /api/todos/:id` and `Not yet` ticks nothing, and each writes down that the
 * question was asked — which is what stops it returning. The prompt itself never ticks
 * anything on a timer or on dismissal; the only writes happen on a tap.
 *
 * Built from the dialog primitive: an overlay that takes focus is the shape a question
 * needs, and dismissing it (Escape, the close control) is the same as `Not yet` — the
 * owner has seen it, so the question cannot keep returning.
 */
export function DonePrompt({ question, onAnswered }: Readonly<DonePromptProps>) {
  const [pending, startTransition] = useTransition();
  // Kept locally so the panel can close on a tap without waiting for the server to
  // come back; a failed write reopens it on the next load, which is the honest state.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const asked = question !== null && dismissed !== question.sessionId;

  function answer(choice: 'done' | 'not-yet'): void {
    if (question === null) return;
    setDismissed(question.sessionId);
    startTransition(async () => {
      await answerFocusQuestionAction(question.sessionId, question.todoId, choice);
      onAnswered();
    });
  }

  return (
    <Dialog
      open={asked}
      onOpenChange={(open) => {
        if (!open) answer('not-yet');
      }}
      title="Finished that task?"
      description={
        question === null
          ? undefined
          : `${question.minutes} focused ${question.minutes === 1 ? 'minute' : 'minutes'} on “${question.title}”. Tick it off if you are done with it.`
      }
      size="sheet"
      footer={
        // The footer is already a flex row, so the buttons are its direct children: a
        // full-width button inside another row fills the line and pushes its sibling down.
        <>
          <Button variant="ghost" disabled={pending} onClick={() => answer('not-yet')}>
            Not yet
          </Button>
          <Button disabled={pending} onClick={() => answer('done')}>
            Done
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
