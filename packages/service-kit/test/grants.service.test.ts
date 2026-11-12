import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import { GrantsService } from '../src/grants/grants.service.js';
import { OriginGrant } from '../src/grants/origin-grant.entity.js';

/**
 * The grant lookup contract: the pair `(ownerSub, clientId)` resolves to the
 * single `originService` that user granted that producer app, and a pair with no
 * row resolves to nothing at all — the caller's cue to answer 403 rather than
 * write somewhere unintended.
 *
 * A grant is per owner, so the same client id granted by two users is two rows:
 * the lookup must never answer one user's grant to another user's request.
 */

const ownerA = 'user-a';
const ownerB = 'user-b';
const producerA = 'producer-a';
const grantedAt = new Date('2026-01-01T00:00:00.000Z');

function serviceWithGrants(rows: OriginGrant[]): GrantsService {
  const originGrants = {
    findOne: jest.fn(
      async ({ where }: { where: { ownerSub: string; clientId: string } }) =>
        rows.find((row) => row.ownerSub === where.ownerSub && row.clientId === where.clientId) ??
        null,
    ),
  } as unknown as Repository<OriginGrant>;
  return new GrantsService(originGrants);
}

describe('GrantsService.findGrantedOrigin', () => {
  it('returns the origin the owner granted to the client', async () => {
    const grants = serviceWithGrants([
      { ownerSub: ownerA, clientId: producerA, originService: 'meal-service', grantedAt },
    ]);

    await expect(grants.findGrantedOrigin(ownerA, producerA)).resolves.toBe('meal-service');
  });

  it('answers each owner its own origin when two owners grant the same client', async () => {
    const grants = serviceWithGrants([
      { ownerSub: ownerA, clientId: producerA, originService: 'meal-service', grantedAt },
      { ownerSub: ownerB, clientId: producerA, originService: 'calendar-service', grantedAt },
    ]);

    await expect(grants.findGrantedOrigin(ownerA, producerA)).resolves.toBe('meal-service');
    await expect(grants.findGrantedOrigin(ownerB, producerA)).resolves.toBe('calendar-service');
  });

  it("never answers another owner's grant for the same client", async () => {
    const grants = serviceWithGrants([
      { ownerSub: ownerA, clientId: producerA, originService: 'meal-service', grantedAt },
    ]);

    await expect(grants.findGrantedOrigin(ownerB, producerA)).resolves.toBeNull();
  });

  it('returns null for a pair that holds no grant row', async () => {
    const grants = serviceWithGrants([
      { ownerSub: ownerA, clientId: producerA, originService: 'meal-service', grantedAt },
    ]);

    await expect(grants.findGrantedOrigin(ownerA, 'producer-b')).resolves.toBeNull();
  });
});
