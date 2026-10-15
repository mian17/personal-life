import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Food } from './food.entity';

/**
 * One pickable serving size of a food ("100 g", "1 cup"), with the nutrients
 * exactly that size provides — the per-serving vector, always complete
 * (`SPEC-nutrition-model`). It is derived from the food's base vector with the
 * model's pure `scale()`, never sent by a client and never recomputed on read.
 *
 * `ownerSub` is stamped from `@Principal()` alongside the food's. Note-service's
 * join rows (`note_tag`) carry no owner, but they hold only ids; a serving row
 * holds content, so it stays independently owner-filterable.
 */
@Entity('serving')
@Index('IDX_serving_owner_sub', ['ownerSub'])
@Index('IDX_serving_food_id', ['foodId'])
export class Serving {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'text' })
  foodId: string;

  /** `enc.v1.` envelope of the human-readable size, exactly as stored. */
  @Column({ type: 'text' })
  label: string;

  @Column({ type: 'real' })
  grams: number;

  /** `enc.v1.` envelope of the JSON nutrient vector for exactly this serving. */
  @Column({ type: 'text' })
  nutrients: string;

  @ManyToOne(() => Food, (food) => food.servings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'foodId' })
  food: Food;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}