import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSessionDto } from '../src/sessions/dto/create-session.dto.js';
import { ListSessionsQuery } from '../src/sessions/dto/list-sessions.query.js';
import { DATE_ONLY, MINUTES_RANGE } from '../src/sessions/dto/session-rules.js';

/**
 * `SPEC-focus-service` §1 / §9.2 — the session boundary's two rules, as the global
 * validation pipe actually enforces them.
 *
 * The pipe is configured exactly as `app.factory.ts` configures it, so what passes
 * here is what reaches a handler. Seconds are absent on purpose: the client floors
 * to whole minutes before the request exists, so flooring is asserted where that
 * input lives, not against this boundary.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

async function validateBody(body: Record<string, unknown>): Promise<CreateSessionDto> {
  return pipe.transform(body, { type: 'body', metatype: CreateSessionDto });
}

async function validateQuery(query: Record<string, unknown>): Promise<ListSessionsQuery> {
  return pipe.transform(query, { type: 'query', metatype: ListSessionsQuery });
}

const A_DAY = '2026-10-28';

describe('MINUTES_RANGE', () => {
  it('runs from one minute to one hundred eighty, both inclusive', () => {
    expect(MINUTES_RANGE).toEqual({ min: 1, max: 180 });
  });
});

describe('CreateSessionDto — minutes', () => {
  it('accepts the lower bound, one whole minute', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 1 })).resolves.toMatchObject({
      date: A_DAY,
      minutes: 1,
    });
  });

  it('accepts the upper bound', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 180 })).resolves.toMatchObject({
      minutes: 180,
    });
  });

  it('refuses zero minutes: a discarded block is never a row', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a fractional minute, so seconds never leak in', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 1.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a block longer than the maximum', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 181 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a minutes value that is not a number at all', async () => {
    await expect(validateBody({ date: A_DAY, minutes: 'twenty' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validateBody({ date: A_DAY })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateSessionDto — date', () => {
  it('matches the date shape it publishes', () => {
    expect(DATE_ONLY.test(A_DAY)).toBe(true);
    expect(DATE_ONLY.test('28-10-2026')).toBe(false);
    expect(DATE_ONLY.test('2026-10-28T00:00:00Z')).toBe(false);
  });

  it('refuses a malformed date', async () => {
    for (const date of ['28-10-2026', '2026-1-28', '', 'today']) {
      await expect(validateBody({ date, minutes: 20 })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a body that carries its own owner', async () => {
    await expect(
      validateBody({ date: A_DAY, minutes: 20, ownerSub: 'sub-2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ListSessionsQuery — both range bounds are the client's", () => {
  it('accepts a well-formed range', async () => {
    await expect(validateQuery({ from: '2026-10-01', to: '2026-10-31' })).resolves.toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('refuses a range missing either bound', async () => {
    await expect(validateQuery({ from: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validateQuery({ to: '2026-10-31' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a malformed bound', async () => {
    await expect(validateQuery({ from: '01-10-2026', to: '2026-10-31' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
