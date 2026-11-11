import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { AuditEntry } from '../src/audit/audit-entry.entity.js';
import {
  deriveCredentialKind,
  deriveDecision,
  deriveRoute,
  deriveVia,
  sanitizeRequestId,
  sanitizeUserAgent,
  UNMATCHED_ROUTE,
  MAX_REQUEST_ID_LENGTH,
  MAX_USER_AGENT_LENGTH,
  type CredentialPresence,
} from '../src/audit/audit-fields.js';

/** The credentials one request presents; the whole input to `via`/`credentialKind`. */
const presence = (given: Partial<CredentialPresence>): CredentialPresence => ({
  hasSessionCookie: false,
  hasBearerToken: false,
  hasCallerClaim: false,
  ...given,
});

describe('deriveVia', () => {
  it('is anonymous when no credential is present', () => {
    expect(deriveVia(presence({}))).toBe('anonymous');
  });

  it('is oidc-cookie when a session cookie is present', () => {
    expect(deriveVia(presence({ hasSessionCookie: true }))).toBe('oidc-cookie');
  });

  it('is bearer for a bearer token with no caller claim', () => {
    expect(deriveVia(presence({ hasBearerToken: true }))).toBe('bearer');
  });

  it('is service-call for a bearer token plus a caller claim', () => {
    expect(deriveVia(presence({ hasBearerToken: true, hasCallerClaim: true }))).toBe(
      'service-call',
    );
  });

  it('prefers the cookie over a bearer token, matching deriveCredentialKind', () => {
    const bothKinds = presence({
      hasSessionCookie: true,
      hasBearerToken: true,
      hasCallerClaim: true,
    });
    expect(deriveVia(bothKinds)).toBe('oidc-cookie');
    expect(deriveCredentialKind(bothKinds)).toBe('cookie');
  });
});

describe('deriveCredentialKind', () => {
  it('maps cookie, bearer and absence to their kinds', () => {
    expect(deriveCredentialKind(presence({ hasSessionCookie: true }))).toBe('cookie');
    expect(deriveCredentialKind(presence({ hasBearerToken: true }))).toBe('bearer');
    expect(deriveCredentialKind(presence({}))).toBe('none');
  });

  it('is none for a caller claim alone — a claim is not a credential', () => {
    expect(deriveCredentialKind(presence({ hasCallerClaim: true }))).toBe('none');
  });
});

describe('deriveDecision', () => {
  it('allows every status under 400', () => {
    expect(deriveDecision(200)).toBe('allowed');
    expect(deriveDecision(201)).toBe('allowed');
    expect(deriveDecision(399)).toBe('allowed');
  });

  it('denies 401 and 403', () => {
    expect(deriveDecision(401)).toBe('denied');
    expect(deriveDecision(403)).toBe('denied');
  });

  it('calls every other failure an error', () => {
    expect(deriveDecision(400)).toBe('error');
    expect(deriveDecision(404)).toBe('error');
    expect(deriveDecision(500)).toBe('error');
  });
});

describe('deriveRoute', () => {
  it('keeps the route template', () => {
    expect(deriveRoute('/notes/:id')).toBe('/notes/:id');
  });

  it('stores the sentinel when no route matched', () => {
    expect(deriveRoute(null)).toBe(UNMATCHED_ROUTE);
    expect(deriveRoute(undefined)).toBe(UNMATCHED_ROUTE);
    expect(deriveRoute('')).toBe(UNMATCHED_ROUTE);
  });

  it('never stores the sentinel for a matched template', () => {
    expect(deriveRoute('/notes/:id')).not.toBe(UNMATCHED_ROUTE);
  });
});

describe('sanitizeUserAgent', () => {
  it('collapses control characters and newlines to single spaces', () => {
    expect(sanitizeUserAgent('Mozilla/5.0\r\n\tEvil\u0000Agent')).toBe('Mozilla/5.0 Evil Agent');
  });

  it('treats an absent user agent as an empty claim', () => {
    expect(sanitizeUserAgent(null)).toBe('');
    expect(sanitizeUserAgent(undefined)).toBe('');
  });

  it('caps the stored value at 256 characters', () => {
    const stored = sanitizeUserAgent('a'.repeat(1000));
    expect(stored).toHaveLength(MAX_USER_AGENT_LENGTH);
    expect(MAX_USER_AGENT_LENGTH).toBe(256);
  });

  it('leaves a value shorter than the cap untouched', () => {
    expect(sanitizeUserAgent('curl/8.4.0')).toBe('curl/8.4.0');
  });
});

describe('sanitizeRequestId', () => {
  it('collapses control characters and newlines to single spaces', () => {
    expect(sanitizeRequestId('abc\r\nEVIL\u0000id')).toBe('abc EVIL id');
  });

  it('reports an absent header as null, so the caller mints a UUID instead', () => {
    expect(sanitizeRequestId(null)).toBeNull();
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId('')).toBeNull();
  });

  it('treats a header of only control characters as absent, not as an empty id', () => {
    expect(sanitizeRequestId('\r\n\u0000')).toBeNull();
  });

  it('caps the stored value at 64 characters', () => {
    expect(sanitizeRequestId('a'.repeat(1000))).toHaveLength(MAX_REQUEST_ID_LENGTH);
    expect(MAX_REQUEST_ID_LENGTH).toBe(64);
  });

  it('leaves a plausible correlation id untouched', () => {
    expect(sanitizeRequestId('7f3c9a1e-2b4d-4c8a-9f10-5e6d7c8b9a01')).toBe(
      '7f3c9a1e-2b4d-4c8a-9f10-5e6d7c8b9a01',
    );
  });
});

describe('AuditEntry', () => {
  /** The entity's column properties, in declaration order. */
  const columnNames = (): string[] =>
    getMetadataArgsStorage()
      .columns.filter((column) => column.target === AuditEntry)
      .map((column) => column.propertyName);

  it('maps exactly the intent\u2019s 14 fields', () => {
    expect(columnNames()).toEqual([
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
    ]);
  });

  it('is named audit_log', () => {
    const entity = getMetadataArgsStorage().tables.find((table) => table.target === AuditEntry);
    expect(entity?.name).toBe('audit_log');
  });

  it('indexes occurredAt and nothing else', () => {
    const indices = getMetadataArgsStorage().indices.filter((index) => index.target === AuditEntry);
    expect(indices.map((index) => index.columns)).toEqual([['occurredAt']]);
  });

  it('uses driver-portable column types only', () => {
    const types = getMetadataArgsStorage()
      .columns.filter((column) => column.target === AuditEntry)
      .map((column) => (column.options.type === Date ? 'Date' : column.options.type));
    expect([...new Set(types)].sort()).toEqual(['Date', 'integer', 'text']);
  });

  it('accepts a randomUUID string as the id', () => {
    const entry = new AuditEntry();
    entry.id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(entry.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });
});
