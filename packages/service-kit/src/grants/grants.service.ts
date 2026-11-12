import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OriginGrant } from './origin-grant.entity.js';

/**
 * The only read path to `origin_grant`.
 *
 * A handler asks this service which origin one user's producer app may write; it
 * never reads `originService` from the request. The lookup is keyed on the pair
 * `(ownerSub, clientId)` because a grant is one user allowing one producer app to
 * write one origin — the same client granted by user A says nothing about user B.
 * A pair with no row is not granted anything and the caller turns that miss into
 * a 403.
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
}
