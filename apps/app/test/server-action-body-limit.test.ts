import * as fs from 'fs';
import * as path from 'path';

/**
 * The photo door's regression guard. `estimatePhotoAction` receives the camera's
 * `File` itself, so an upload dies at the BFF's Server Action body ceiling before
 * the action runs — the deployed symptom was `Body exceeded 1 MB limit` in
 * `docker compose logs app` with no `POST /api/estimates/photo` in `meal-service`.
 * The ceiling has one authority, `JSON_BODY_LIMIT` in the meal service; this test
 * fails the moment the two numbers drift or the ceiling falls back under Next's
 * 1 MB default.
 */
const appRoot = path.join(__dirname, '..');
const nextConfig = fs.readFileSync(path.join(appRoot, 'next.config.mjs'), 'utf8');
const mealServiceFactory = fs.readFileSync(
  path.join(appRoot, '..', 'meal-service', 'src', 'app.factory.ts'),
  'utf8',
);

const BYTES_PER_UNIT: Record<string, number> = { b: 1, kb: 1024, mb: 1024 * 1024 };

/** A Next/Express size string (`8mb`, `512kb`) as bytes. */
function toBytes(size: string): number {
  const parts = /^(\d+)\s*(b|kb|mb)$/i.exec(size.trim());
  if (!parts) throw new Error(`unreadable size limit "${size}"`);
  const [, amount, unit] = parts;
  return Number(amount) * BYTES_PER_UNIT[unit.toLowerCase()];
}

/** The byte ceiling assigned to `name` in `source`, written as `name: '8mb'` or `name = '8mb'`. */
function ceilingNamed(source: string, name: string): number {
  const limit = new RegExp(`${name}\\s*[:=]\\s*'([^']+)'`).exec(source);
  if (!limit) throw new Error(`no ${name} declared`);
  return toBytes(limit[1]);
}

describe('Server Action body limit', () => {
  it('fits a phone photo, not Next default 1 MB', () => {
    expect(ceilingNamed(nextConfig, 'bodySizeLimit')).toBeGreaterThan(1024 * 1024);
  });

  it('matches the meal service request ceiling', () => {
    expect(ceilingNamed(nextConfig, 'bodySizeLimit')).toBe(
      ceilingNamed(mealServiceFactory, 'JSON_BODY_LIMIT'),
    );
  });
});
