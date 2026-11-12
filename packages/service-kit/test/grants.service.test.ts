import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import { GrantsService } from '../src/grants/grants.service.js';
import { OriginGrant } from '../src/grants/origin-grant.entity.js';

/**
 * The grant lookup contract: the triple `(ownerSub, clientId, direction)` resolves
 * to the one `originService` that user granted that producer app **for that
 * capability**, and a triple with no row resolves to nothing at all — the caller's
 * cue to answer 403 rather than write somewhere unintended.
 *
 * A grant is per owner, so the same client id granted by two users is two rows: the
 * lookup must never answer one user's grant to another user's request.
 *
 * The last block is the load-bearing one. The BFF presents one `client_id` (`app`)
 * for every app it proxies, so meals and focus hold rows for the identical
 * `(ownerSub, clientId)` pair — which is why `direction` is in the primary key. With
 * a two-column key the focus read grant overwrites the meals write grant and meals
 * silently stops being able to write.
 */

const ownerA = 'user-a';
const ownerB = 'user-b';
const producerA = 'producer-a';
const appClient = 'app';
const grantedAt = new Date('2026-01-01T00:00:00.000Z');

type Where = { ownerSub?: string; clientId?: string; direction?: string };

/** A write grant row, the shape every row predating the direction column has. */
const writeGrant = (ownerSub: string, clientId: string, originService: string): OriginGrant =>
  ({
    ownerSub,
    clientId,
    direction: 'write',
    originService,
    scope: null,
    grantedAt,
    disclosure: null,
    disclosureHash: null,
  }) as OriginGrant;

/** A read grant row: the second capability the same pair may hold. */
const readGrant = (
  ownerSub: string,
  clientId: string,
  originService: string,
  scope: 'own-origin' | 'all' | null,
): OriginGrant =>
  ({
    ownerSub,
    clientId,
    direction: 'read',
    originService,
    scope,
    grantedAt,
    disclosure: null,
    disclosureHash: null,
  }) as OriginGrant;

function serviceWithGrants(rows: OriginGrant[]): GrantsService {
  const matches = (row: OriginGrant, where: Where): boolean =>
    row.ownerSub === where.ownerSub &&
    row.clientId === where.clientId &&
    (where.direction === undefined || row.direction === where.direction);
  const originGrants = {
    findOne: jest.fn(async ({ where }: { where: Where }) => {
      const found = rows.find((row) => matches(row, where));
      return found ?? null;
    }),
  } as unknown as Repository<OriginGrant>;
  return new GrantsService(originGrants);
}

describe('GrantsService.findGrantedOrigin', () => {
  it('returns the origin the owner granted to the client', async () => {
    const grants = serviceWithGrants([writeGrant(ownerA, producerA, 'meal-service')]);

    await expect(grants.findGrantedOrigin(ownerA, producerA)).resolves.toBe('meal-service');
  });

  it('answers each owner its own origin when two owners grant the same client', async () => {
    const grants = serviceWithGrants([
      writeGrant(ownerA, producerA, 'meal-service'),
      writeGrant(ownerB, producerA, 'calendar-service'),
    ]);

    await expect(grants.findGrantedOrigin(ownerA, producerA)).resolves.toBe('meal-service');
    await expect(grants.findGrantedOrigin(ownerB, producerA)).resolves.toBe('calendar-service');
  });

  it("never answers another owner's grant for the same client", async () => {
    const grants = serviceWithGrants([writeGrant(ownerA, producerA, 'meal-service')]);

    await expect(grants.findGrantedOrigin(ownerB, producerA)).resolves.toBeNull();
  });

  it('returns null for a pair that holds no grant row', async () => {
    const grants = serviceWithGrants([writeGrant(ownerA, producerA, 'meal-service')]);

    await expect(grants.findGrantedOrigin(ownerA, 'producer-b')).resolves.toBeNull();
  });

  it('ignores a read grant: a reader may not write', async () => {
    // The same pair holding only a read row must resolve to no write origin, or the
    // focus app could create todos it was never granted the ability to create.
    const grants = serviceWithGrants([readGrant(ownerA, producerA, 'focus-service', 'all')]);

    await expect(grants.findGrantedOrigin(ownerA, producerA)).resolves.toBeNull();
  });
});

describe('GrantsService.findReadGrant', () => {
  it('answers the origin and scope of a read grant', async () => {
    const grants = serviceWithGrants([readGrant(ownerA, appClient, 'focus-service', 'all')]);

    await expect(grants.findReadGrant(ownerA, appClient)).resolves.toEqual({
      originService: 'focus-service',
      scope: 'all',
    });
  });

  it('returns null for a pair that holds only a write grant', async () => {
    // A writer may not read: meals holds the write direction for the same pair and
    // that says nothing about reading the owner's tasks.
    const grants = serviceWithGrants([writeGrant(ownerA, appClient, 'meal-service')]);

    await expect(grants.findReadGrant(ownerA, appClient)).resolves.toBeNull();
  });
});

describe('GrantsService — direction is part of the key', () => {
  it('keeps a write grant and a read grant side by side for one (owner, client) pair', async () => {
    // The BFF presents `app` as the client for every app, so this is exactly the
    // production shape: meals holds write, focus holds read, same owner, same client.
    const grants = serviceWithGrants([
      writeGrant(ownerA, appClient, 'meal-service'),
      readGrant(ownerA, appClient, 'focus-service', 'all'),
    ]);

    await expect(grants.findGrantedOrigin(ownerA, appClient)).resolves.toBe('meal-service');
    await expect(grants.findReadGrant(ownerA, appClient)).resolves.toEqual({
      originService: 'focus-service',
      scope: 'all',
    });
  });
});
