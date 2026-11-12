import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { disclosureHash } from './disclosure.js';
import { OriginGrant, type GrantDirection, type GrantScope } from './origin-grant.entity.js';

/**
 * What a read grant allows: the origin it is scoped to, and how far it reaches.
 * `scope === 'all'` means every open task of the owner; `'own-origin'` means only
 * the rows this producer itself created.
 */
export type ReadGrant = { originService: string; scope: GrantScope | null };

/**
 * The grant layer: two read paths and one self-service write path to `origin_grant`.
 *
 * A handler asks this service which origin one user's producer app may write —
 * or, for the read direction, which origin and scope it may read — and never reads
 * `originService` from the request. A lookup is keyed on `(ownerSub, clientId,
 * direction)` because a grant is one user allowing one producer app one capability:
 * the same client granted by user A says nothing about user B, and the same pair
 * holding a write grant says nothing about what it may read. A lookup that finds no
 * row is not granted anything and the caller turns that miss into a 403.
 *
 * The only other writer of this table is the operator CLI
 * (`apps/todo-service/scripts/grant-origin.ts`), which provisions a grant for
 * someone else. `grantOwn` below is the user granting their own producer, from that
 * producer's settings screen.
 */
@Injectable()
export class GrantsService {
  constructor(
    @InjectRepository(OriginGrant)
    private readonly originGrants: Repository<OriginGrant>,
  ) {}

  /**
   * The origin `ownerSub` granted to `clientId` **for writing**, or `null` when
   * that user holds no write grant for that producer app.
   *
   * The `direction: 'write'` filter is what keeps this method's meaning while the
   * table gained a second capability: a client holding only a read grant must not
   * be able to write, and the write path (`todos.service.ts`'s `grantedOrigin`)
   * calls this one method and nothing else.
   */
  async findGrantedOrigin(ownerSub: string, clientId: string): Promise<string | null> {
    const grant = await this.originGrants.findOne({
      where: { ownerSub, clientId, direction: 'write' },
    });
    return grant?.originService ?? null;
  }

  /**
   * The read grant `ownerSub` gave `clientId`, or `null` when there is none — the
   * caller's cue to answer 403 rather than serve an empty list, because "you may
   * not read this" and "you may read this and it is empty" are different answers.
   */
  async findReadGrant(ownerSub: string, clientId: string): Promise<ReadGrant | null> {
    const grant = await this.originGrants.findOne({
      where: { ownerSub, clientId, direction: 'read' },
    });
    if (grant === null) return null;
    return { originService: grant.originService, scope: grant.scope };
  }

  /**
   * Record that `ownerSub` themselves allows `clientId` the capability described by
   * `grant` — a `direction`, the origin it is scoped to, and (for a read grant) a
   * `scope` — storing the sentence they agreed to and its sha256 beside it.
   *
   * This is the **only** self-service write path; everything else is the operator
   * CLI. It is an upsert on the full primary key `(ownerSub, clientId, direction)`
   * because a grant is a current permission rather than an event log: re-enabling
   * the same producer refreshes one row, never adds a second — while a read grant
   * for that same pair is a **different** row, so turning focus on cannot destroy
   * the meals write grant that shares its `client_id`. The consent columns are
   * refreshed with it, so the sentence stored is always the one shown on the run
   * that last turned it on.
   *
   * `ownerSub`, `clientId` and the value returned here to the caller all come from
   * the caller's verified identity at every call site — a route passes its
   * `@Principal()`, never a request field.
   */
  async grantOwn(
    ownerSub: string,
    clientId: string,
    originService: string,
    disclosure: string,
    grant: { direction?: GrantDirection; scope?: GrantScope | null } = {},
  ): Promise<OriginGrant> {
    const direction = grant.direction ?? 'write';
    await this.originGrants.upsert(
      {
        ownerSub,
        clientId,
        direction,
        originService,
        // A write grant is already scoped by `originService`; only a read grant
        // carries a reach, and an omitted one means the narrowest.
        scope: direction === 'read' ? (grant.scope ?? null) : null,
        grantedAt: new Date(),
        disclosure,
        disclosureHash: disclosureHash(disclosure),
      },
      ['ownerSub', 'clientId', 'direction'],
    );
    // Read back rather than echo the input: the caller returns what the table now
    // holds, so a driver that normalises `grantedAt` cannot make the answer lie.
    return this.originGrants.findOneOrFail({ where: { ownerSub, clientId, direction } });
  }
}
