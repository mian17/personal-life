import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbackCursor } from '../feedback/feedback-cursor.entity';
import { FeedbackEvent } from '../feedback/feedback-event.entity';
import { DispatcherService } from './dispatcher.service';
import { EVENT_SINK, RabbitPublisher } from './publisher.service';

/**
 * The durable event path (`SPEC-feedback-service` Event stream): the boot-ensured
 * NOTIFY trigger, the persistent-LISTEN dispatcher, and the confirm publisher.
 *
 * The publisher is provided under the `EVENT_SINK` token so tests can inject a
 * fake sink that records confirms (Testing strategy 3); the dispatcher never
 * sees amqplib.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FeedbackEvent, FeedbackCursor])],
  providers: [{ provide: EVENT_SINK, useFactory: () => new RabbitPublisher() }, DispatcherService],
})
export class EventModule {}
