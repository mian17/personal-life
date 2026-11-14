import { Module } from '@nestjs/common';
import { FOCUS_TODOS, FOCUS_TODOS_API_URL_ENV, HttpFocusTodos } from './focus-todos.client.js';

/**
 * The todo-service read leg, provided once for the whole service.
 *
 * The URL is read at module init and handed to the client, so there is exactly one
 * place the variable is read. An unset value is not a boot failure: a session with no
 * task needs no todo-service at all, so only a task-linked write refuses.
 */
@Module({
  providers: [
    {
      provide: FOCUS_TODOS,
      useFactory: () => new HttpFocusTodos(process.env[FOCUS_TODOS_API_URL_ENV]?.trim()),
    },
  ],
  exports: [FOCUS_TODOS],
})
export class FocusTodosModule {}
