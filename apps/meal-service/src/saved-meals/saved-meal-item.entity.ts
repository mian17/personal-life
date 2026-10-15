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
import { SavedMeal } from './saved-meal.entity';

/**
 * One frozen per-item snapshot inside a saved meal
 * (`docs/intent/meal-nutrition.md`: "Saved meal = frozen snapshot"; Task 11).
 * The row is a **copy** of the corrected values at save time: the `foodId` it
 * came from is metadata with no relation, so a food later edited or deleted
 * cannot rewrite the snapshot.
 *
 * Each row is sealed with byte-exact AAD `life.v1|<sub>|meal|meal|<field>|<id>`
 * (`SPEC-meal-service`, `food.entity.ts`); the two entity ids are
 * service-generated (`randomUUID`) before insert so every row binds only after
 * decryption. Content fields are `enc.v1.` envelopes, never plaintext.
 */
@Entity('saved_meal_item')
@Index('IDX_saved_meal_item_owner_sub', ['ownerSub'])
@Index('IDX_saved_meal_item_saved_meal_id', ['savedMealId'])
export class SavedMealItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  @Column({ type: 'text' })
  savedMealId: string;

  /**
   * The catalog food this item was saved from. An optional plain id with no
   * relation: the row keeps its own snapshot, so a food later removed
   * cannot cascade the saved meal away (mirrors `entry.foodId`).
   */
  @Column({ type: 'text', nullable: true })
  foodId: string | null;

  /** Servings logged — the `quantity` the snapshot was sealed against. */
  @Column({ type: 'real' })
  quantity: number;

  /** `enc.v1.` envelope of the corrected per-item nutrient vector. */
  @Column({ type: 'text' })
  nutrients: string;

  @ManyToOne(() => SavedMeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'savedMealId' })
  savedMeal: SavedMeal;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
