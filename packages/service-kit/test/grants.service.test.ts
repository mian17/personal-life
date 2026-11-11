import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import { GrantsService } from '../src/grants/grants.service.js';
import { OriginGrant } from '../src/grants/origin-grant.entity.js';

/**
 * The grant lookup contract: one `client_id` resolves to its single granted
 * `originService`, and an unprovisioned client resolves to nothing at all — the
 * caller's cue to answer 403 rather than write somewhere unintended.
 */

const clientId = 'producer-a';
const grantedAt = new Date('2026-01-01T00:00:00.000Z');

function serviceWithGrants(rows: OriginGrant[]): GrantsService {
  const originGrants = {
    findOne: jest.fn(
      async ({ where }: { where: { clientId: string } }) =>
        rows.find((row) => row.clientId === where.clientId) ?? null,
    ),
  } as unknown as Repository<OriginGrant>;
  return new GrantsService(originGrants);
}

describe('GrantsService.findByClientId', () => {
  it('returns the origin granted to a client that holds a grant row', async () => {
    const grants = serviceWithGrants([{ clientId, originService: 'todo', grantedAt }]);

    await expect(grants.findByClientId(clientId)).resolves.toBe('todo');
  });

  it('returns null for a client that holds no grant row', async () => {
    const grants = serviceWithGrants([{ clientId, originService: 'todo', grantedAt }]);

    await expect(grants.findByClientId('producer-b')).resolves.toBeNull();
  });
});
