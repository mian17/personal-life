import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Serving } from './serving.entity';

/**
 * One owner-scoped catalog food (`SPEC-meal-service` foods): what a serving
 * weighs and what that serving provides. The id is service-generated
 * (`randomUUID`) before insert so the at-rest AAD that binds it is
 * reconstructible; `ownerSub` is stamped from `@Principal()`, never the body.
 *
 * Two content fields are `enc.v1.` envelopes: `name` (searched post-decrypt, so
 * it is never matched in SQL) and the optional base `nutrients` vector.
 */
@Entity('food')
@Index('IDX_food_owner_sub', ['ownerSub'])
export class Food {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  /** `enc.v1.` envelope of the food name. */
  @Column({ type: 'text' })
  name: string;

  /** Grams in one base serving — the unit `scale()` scales a portion against. */
  @Column({ type: 'real' })
  servingGrams: number;

  /**
   * The base per-serving vector as an `enc.v1.` envelope, or NULL meaning "all
   * zeroes" (`SPEC-meal-service` Nutrient semantics: missing data is 0, with no
   * "unknown" state in the stored vector). Serving rows derive their own vector
   * from this one, so a food is the single source of its nutrient numbers.
   */
  @Column({ type: 'text', nullable: true })
  nutrients: string | null;

  @Column({ type: 'integer', default: 0 })
  version: number;

  @Column({ type: 'datetime', nullable: true })
  deletedAt: Date | null;

  /** The pickable serving sizes, each with its own sealed vector. */
  @OneToMany(() => Serving, (serving) => serving.food)
  servings: Serving[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}