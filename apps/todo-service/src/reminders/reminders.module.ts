import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Todo } from '../todos/todo.entity.js';
import { TodosModule } from '../todos/todos.module.js';
import { PushModule } from '../push/push.module.js';
import { ReminderService } from './reminder.service.js';
import { REMINDER_PUSH_SENDER, WebPushSender } from './push-sender.js';

/**
 * The bounded reminders module (`SPEC-todo-due-repeat-notify`). It owns the
 * sweep and the push sender seam; the todo clear is delegated to
 * `TodosService.markReminded`, subscriptions come from `PushService`, and the
 * title DEK from `KeysService`. `REMINDER_PUSH_SENDER` is the replaceable
 * boundary tests swap for a fake.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Todo]),
    TodosModule,
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    PushModule,
  ],
  providers: [ReminderService, { provide: REMINDER_PUSH_SENDER, useClass: WebPushSender }],
  exports: [ReminderService],
})
export class RemindersModule {}
