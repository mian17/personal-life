import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { disclosureHash } from './disclosure.js';
import { OriginGrant } from './origin-grant.entity.js';

/**
 * The grant layer: one read path and one self-service write path to `origin_grant`.
 *
 * A handler asks this service which origin one user's producer app may write; it
 * never reads `originService` from the request. The lookup is keyed on the pair
 * `(ownerSub, clientId)` because a grant is one user allowing one producer app to
 * write one origin — the same client granted by user A says nothing about user B.
 * A pair with no row is not granted anything and the caller turns that miss into
 * a 403.
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
   * The origin `ownerSub` granted to `clientId`, or `null` when that user holds
   * no grant for that producer app.
   */
  async findGrantedOrigin(ownerSub: string, clientId: string): Promise<string | null> {
    const grant = await this.originGrants.findOne({ where: { ownerSub, clientId } });
    return grant?.originService ?? null;
  }

  /**
   * Record that `ownerSub` themselves allows `clientId` to write `originService`,
   * storing the sentence they agreed to and its sha256 beside it.
   *
   * This is the **only** self-service write path; everything else is the operator
   * CLI. It is an upsert on `(ownerSub, clientId)` because a grant is a current
   * permission rather than an event log: re-enabling the same producer refreshes
   * one row, never adds a second. The consent columns are refreshed with it, so the
   * sentence stored is always the one shown on the run that last turned it on.
   *
   * `ownerSub` and `clientId` are the caller's verified identity at every call
   * site — a route passes its `@Principal()`, never a request field.
   */
  async grantOwn(
    ownerSub: string,
    clientId: string,
    originService: string,
    disclosure: string,
  ): Promise<OriginGrant> {
    await this.originGrants.upsert(
      {
        ownerSub,
        clientId,
        originService,
        grantedAt: new Date(),
        disclosure,
        disclosureHash: disclosureHash(disclosure),
      },
      ['ownerSub', 'clientId'],
    );
    // Read back rather than echo the input: the caller returns what the table now
    // holds, so a driver that normalises `grantedAt` cannot make the answer lie.
    return this.originGrants.findOneOrFail({ where: { ownerSub, clientId } });
  }
}
