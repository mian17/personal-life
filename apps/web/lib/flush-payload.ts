import 'server-only';
import { TAG_NAME_MAX } from '@life/shared';
import { ApiError } from './api';

export function isTagArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === 'string' && item.length <= TAG_NAME_MAX)
  );
}

export function apiErrorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (!(error instanceof Error)) return null;
  const match = /^API (\d{3}) on /.exec(error.message);
  return match ? Number(match[1]) : null;
}
