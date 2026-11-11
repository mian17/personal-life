import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import {
  createAuditListener,
  resolveAuditListener,
  NOOP_AUDIT_LISTENER,
  type AuditListener,
  type AuditRowWriter,
} from '../src/audit/audit-listener.js';
import type { AuditEntry } from '../src/audit/audit-entry.entity.js';
import type { AuditEvent } from '../src/audit/audit-event.js';

/** The 14 columns an audit row is allowed to have, in entity order (§9.11). */
const AUDIT_COLUMNS = [
  'id',
  'occurredAt',
  'actorSub',
  'callerService',
  'via',
  'credentialKind',
  'method',
  'route',
  'status',
  'decision',
  'sourceIp',
  'userAgent',
  'durationMs',
  'requestId',
];

/** One ordinary witnessed request, before the listener mints its `id`. */
function permittedEvent(): AuditEvent {
  return {
    occurredAt: new Date('2026-05-04T09:30:00.000Z'),
    actorSub: 'user-1',
    callerService: null,
    via: 'bearer',
    credentialKind: 'bearer',
    method: 'GET',
    route: '/notes/:id',
    status: 200,
    decision: 'allowed',
    sourceIp: '10.0.0.7',
    userAgent: 'curl/8.0',
    durationMs: 12,
    requestId: 'request-1',
  };
}

/** A writer that records every row it is asked to save and never fails. */
function recordingWriter(rows: AuditEntry[] = []): AuditRowWriter {
  return {
    save: async (row) => {
      rows.push(row);
      return row;
    },
  };
}

/** Let every pending microtask (and one macrotask) settle before asserting. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe('createAuditListener', () => {
  it('writes one row per event, carrying the minted id and the 13 witnessed fields', async () => {
    const rows: AuditEntry[] = [];
    const listener = createAuditListener(recordingWriter(rows));
    const event = permittedEvent();

    listener(event);
    await settle();

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([...AUDIT_COLUMNS].sort());
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(rows[0]).toMatchObject({ ...event });
  });

  it('mints a different id for each event it writes', async () => {
    const rows: AuditEntry[] = [];
    const listener = createAuditListener(recordingWriter(rows));

    listener(permittedEvent());
    listener(permittedEvent());
    await settle();

    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('returns before the write finishes, so the request path never waits for it', () => {
    const pendingWrite = { resolve: () => undefined as void };
    const writer: AuditRowWriter = {
      save: () => new Promise((resolve) => (pendingWrite.resolve = () => resolve(undefined))),
    };
    const listener = createAuditListener(writer);

    expect(listener(permittedEvent())).toBeUndefined();

    pendingWrite.resolve();
  });

  it('swallows a rejecting save: nothing thrown, nothing unhandled', async () => {
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', recordUnhandled);

    const refusingWriter: AuditRowWriter = {
      save: async () => Promise.reject(new Error('db down')),
    };
    const listener = createAuditListener(refusingWriter);

    expect(() => listener(permittedEvent())).not.toThrow();
    await settle();

    process.off('unhandledRejection', recordUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('swallows a save that throws synchronously', () => {
    const throwingWriter: AuditRowWriter = {
      save: () => {
        throw new Error('no connection');
      },
    };
    const listener = createAuditListener(throwingWriter);

    expect(() => listener(permittedEvent())).not.toThrow();
  });

  it('stores no credential material even when the event carries some', async () => {
    const rows: AuditEntry[] = [];
    const listener = createAuditListener(recordingWriter(rows));
    const leakyEvent = {
      ...permittedEvent(),
      authorization: 'Bearer secret-bearer-token',
      cookie: 'session=cookie-value-42',
      queryString: '?USDA_API_KEY=abc123',
      body: '{"note":"body-substring-marker"}',
    } as AuditEvent;

    listener(leakyEvent);
    await settle();

    const storedValues = Object.values(rows[0])
      .map((value) => String(value))
      .join(' ');
    expect(storedValues).not.toContain('secret-bearer-token');
    expect(storedValues).not.toContain('cookie-value-42');
    expect(storedValues).not.toContain('abc123');
    expect(storedValues).not.toContain('body-substring-marker');
    expect(Object.keys(rows[0]).sort()).toEqual([...AUDIT_COLUMNS].sort());
  });
});

describe('resolveAuditListener', () => {
  it('falls back to the no-op listener when nothing is registered', () => {
    expect(resolveAuditListener()).toBe(NOOP_AUDIT_LISTENER);
  });

  it('returns the registered listener when one is supplied', () => {
    const registered: AuditListener = () => undefined;
    expect(resolveAuditListener(registered)).toBe(registered);
  });

  it('emits on a bus with no listener without throwing', () => {
    const bus = new EventEmitter();
    const listener = resolveAuditListener();

    expect(bus.emit('audit', permittedEvent())).toBe(false);
    expect(() => listener(permittedEvent())).not.toThrow();
  });
});
