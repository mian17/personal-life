import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * This service's own record that an owner enabled the todo integration. One row
 * per owner: its existence means "granted", deleting it is revocation.
 *
 * This flag is **not** the enforcement point. It only decides whether
 * meal-service produces intents at all; the write itself is authorized by
 * todo-service's `origin_grant` row, which is the single place a producer
 * credential is checked. A row here with no grant there produces intents that
 * todo-service refuses — the safe direction, since refusing costs nothing and
 * the reverse (intents never produced because a local flag lagged) is invisible.
 *
 * `disclosure` keeps the exact sentence the user was shown, and `disclosureHash`
 * its sha256 hex, so a later wording change is detectable against the consent
 * that was actually given rather than assumed.
 *
 * Both are NOT NULL, unlike `OriginGrant`'s nullable pair: this row exists only
 * because a user turned the switch on, so no operator path could legitimately
 * create one without a sentence, and a row carrying no consent cannot be written.
 */
@Entity('meal_todo_toggle')
export class MealTodoToggle {
  /** The owner this consent belongs to — the primary key, so one row per owner. */
  @PrimaryColumn({ type: 'text' })
  ownerSub: string;

  /** When the owner turned the integration on. */
  @Column({ type: 'datetime' })
  enabledAt: Date;

  /** The sentence shown at the moment of consent, verbatim. */
  @Column({ type: 'text' })
  disclosure: string;

  /** sha256 hex of `disclosure`, so a re-worded sentence is detectable. */
  @Column({ type: 'text' })
  disclosureHash: string;
}
