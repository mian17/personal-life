import { IsString, Matches, MaxLength } from 'class-validator';
import { DATE_ONLY, SESSION_DATE_MAX } from './session-rules';

/**
 * `GET /api/sessions?from=&to=`: both bounds required, both client-passed days.
 *
 * The range is part of the fetch identity (it sits in the cache key); there is no
 * pagination and no filter here to leak into that key (`SPEC-focus-service` Cache
 * Rules).
 */
export class ListSessionsQuery {
  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  from: string;

  @IsString()
  @MaxLength(SESSION_DATE_MAX)
  @Matches(DATE_ONLY)
  to: string;
}
