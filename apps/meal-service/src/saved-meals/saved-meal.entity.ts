import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One owner-scoped saved meal: a named **frozen snapshot** of one meal's
 * corrected values (`docs/intent/meal-nutrition.md`: "Saved meal = frozen
 * snapshot of corrected values. Later food edits do not retroactively change
 * the saved meal"), so re-logging it is one tap and never re-derives a number.
 *
 * The row carries only the name and the version counter; its `items` hold the
 * frozen per-item values. The id is service-generated (`randomUUID`) before
 * insert so the AAD that binds the name
 * (`life.v1|<sub>|meal|saved-meal-name|<id>`) is reconstructible; `ownerSub` is
 * stamped from `@Principal()`, never the body.
 */
@Entity('saved_meal')
@Index('IDX_saved_meal_owner_sub', ['ownerSub'])
export class SavedMeal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  /** `enc.v1.` envelope of the saved meal's name, exactly as stored. */
  @Column({ type: 'text' })
  name: string;

  /** The meal of the day this snapshot re-logs into (plaintext enum). */
  @Column({ type: 'text' })
  mealGroup: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
