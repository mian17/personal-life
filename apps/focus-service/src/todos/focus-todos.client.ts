import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Env var naming the todo-service base URL this service asks about a task id.
 *
 * No default on purpose (the `MEAL_TODOS_API_URL` precedent): a guessed port dials a
 * closed door and the first write half-succeeds, so an unset variable is a loud
 * refusal naming the variable rather than a quiet miss.
 */
export const FOCUS_TODOS_API_URL_ENV = 'FOCUS_TODOS_API_URL';

/** The one read this service needs from todo-service: the owner's open tasks. */
const OPEN_TASKS_PATH = '/api/todos/origin/open';

/** Nest DI token for the todo-service client. */
export const FOCUS_TODOS = Symbol('FOCUS_TODOS');

export interface FocusTodos {
  /**
   * Throw unless the caller's own read grant covers `todoId`; resolve when it does.
   *
   * The token is forwarded, never minted: `origin_grant` is keyed by the owner and the
   * calling client, so the caller's own bearer token is the only credential that names
   * the right grant.
   */
  assertReadable(todoId: string, authorization: string | undefined): Promise<void>;
}

/** What `GET /api/todos/origin/open` answers, narrowed to the one field this needs. */
interface OpenTask {
  id: string;
}

/**
 * The read leg of the task link: does the caller's grant reach this id?
 *
 * Focus **reads and never writes** a todo. It has no create call and no tick call —
 * ticking happens on the owner's own screen, through the owner's own token
 * (`PATCH /api/todos/:id`), because the owner is the actor. This client exists for
 * exactly one question: is this id one the caller may name?
 */
export class HttpFocusTodos implements FocusTodos {
  constructor(private readonly baseUrl: string | undefined) {}

  async assertReadable(todoId: string, authorization: string | undefined): Promise<void> {
    const open = await this.openTaskIds(authorization);
    if (!open.has(todoId)) {
      // "You may not name this" and "this is not open" are the same refusal here: the
      // route only ever lists tasks the grant reaches and that are still open, so an id
      // outside that set is either another owner's, outside the grant, or already done.
      throw new ForbiddenException('todoId is not an open task this caller may read');
    }
  }

  private async openTaskIds(authorization: string | undefined): Promise<Set<string>> {
    const response = await fetch(`${this.requireBaseUrl()}${OPEN_TASKS_PATH}`, {
      headers: authorization === undefined ? {} : { authorization },
    });
    if (response.status === 403) {
      // No read grant for this client: the id cannot be verified, so it is not stored.
      throw new ForbiddenException('todo-service refused the read: no read grant for this client');
    }
    if (!response.ok) {
      // Unverifiable is refused rather than assumed: storing the id anyway would be the
      // arbitrary string this check exists to keep out.
      throw new ServiceUnavailableException(
        `todo-service answered ${response.status}: the task link cannot be verified`,
      );
    }
    const open = (await response.json()) as OpenTask[];
    return new Set(open.map((task) => task.id));
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException(
        `${FOCUS_TODOS_API_URL_ENV} is unset: a task-linked session cannot be recorded`,
      );
    }
    return this.baseUrl;
  }
}
