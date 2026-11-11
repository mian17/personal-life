import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OriginGrant } from './origin-grant.entity.js';

/**
 * The only read path to `origin_grant`.
 *
 * A handler asks this service which origin the caller's `client_id` may write; it
 * never reads `originService` from the request. A client with no row is not
 * granted anything and the caller turns that miss into a 403.
 */
@Injectable()
export class GrantsService {
  constructor(
    @InjectRepository(OriginGrant)
    private readonly originGrants: Repository<OriginGrant>,
  ) {}

  /** The origin granted to `clientId`, or `null` when the client holds no grant. */
  async findByClientId(clientId: string): Promise<string | null> {
    const grant = await this.originGrants.findOne({ where: { clientId } });
    return grant?.originService ?? null;
  }
}
