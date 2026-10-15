import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * One versioned target row per profile change (`SPEC-target-onboarding`,
 * `SPEC-meal-service` Code Style). Rows are immutable — a profile change
 * INSERTS a new row, never mutates a prior one — so a past date re-renders
 * against the row that applied then.
 *
 * Each row keeps BOTH the profile inputs (age/sex/heightCm/weightKg/activity/
 * goal, so it is reproducible) and the computed outputs (bmr/tdee/calories/
 * proteinG/fatG/carbG, so a read is cheap). The id is service-generated
 * (`randomUUID`) before insert; `ownerSub` is stamped from `@Principal()`,
 * never the request body.
 */
@Entity('target')
@Index('IDX_target_owner_sub', ['ownerSub'])
export class Target {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: true })
  ownerSub: string | null;

  // Client-local `YYYY-MM-DD` this version takes effect on (lesson 0019 —
  // the server never derives a day from its own clock). Stored as text so the
  // exact calendar parts survive without timezone shifting.
  @Column({ type: 'text' })
  validFrom: string;

  @Column({ type: 'integer' })
  age: number;

  @Column({ type: 'text' })
  sex: string;

  @Column({ type: 'real' })
  heightCm: number;

  @Column({ type: 'real' })
  weightKg: number;

  @Column({ type: 'text' })
  activity: string;

  @Column({ type: 'text' })
  goal: string;

  @Column({ type: 'integer' })
  bmr: number;

  @Column({ type: 'integer' })
  tdee: number;

  @Column({ type: 'integer' })
  calories: number;

  @Column({ type: 'integer' })
  proteinG: number;

  @Column({ type: 'integer' })
  fatG: number;

  @Column({ type: 'integer' })
  carbG: number;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
