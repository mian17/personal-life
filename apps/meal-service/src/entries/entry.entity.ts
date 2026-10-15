import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One diary entry: a food × quantity, in a meal group, on a date
 * (`SPEC-meal-service` Nutrient semantics, `docs/intent/meal-nutrition.md`).
 *
 * The row stores the **scaled, confirmed nutrient snapshot** as an `enc.v1.`
 * envelope alongside the `foodId`/`quantity` it came from — it never
 * recomputes from the food on read, so editing a food later cannot rewrite
 * history. Daily totals are `sum()` over the day's entries, computed on read.
 *
 * The id is service-generated (`randomUUID`) before insert so the AAD that binds
 * the snapshot (`life.v1|<sub>|meal|entry|<id>`) is reconstructible;
 * `ownerSub` is stamped from `@Principal()`, never the body.
 */
@Entity('entry')
@Index('IDX_entry_owner_sub', ['ownerSub'])
export class Entry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  /**
   * Client-local `YYYY-MM-DD`. The day belongs to the client: the service
   * receives a resolved date and never derives one from its own process clock
   * (lesson 0019), so it is stored as text and exact calendar parts survive.
   */
  @Column({ type: 'text' })
  date: string;

  /** Which meal of the day this entry belongs to. */
  @Column({ type: 'text' })
  mealGroup: string;

  /**
   * The catalog food the entry was logged from. A plain id with no relation:
   * the row keeps its own snapshot, so a food later removed cannot cascade the
   * diary away (a snapshot outlives its source).
   */
  @Column({ type: 'text' })
  foodId: string;

  /** Servings logged — the `quantity` the snapshot was scaled by. */
  @Column({ type: 'real' })
  quantity: number;

  /** `enc.v1.` envelope of the confirmed JSON nutrient vector — the snapshot. */
  @Column({ type: 'text' })
  nutrients: string;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}