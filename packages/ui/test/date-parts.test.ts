import { todayIsoInZone } from '../src/lib/date-parts';

describe('todayIsoInZone', () => {
  it("is the user's day, not the host's, across the midnight boundary (lesson 0019)", () => {
    // 17:24 UTC on 2026-10-02 is 00:24 on 2026-10-03 in Vietnam (UTC+7).
    expect(todayIsoInZone('Asia/Ho_Chi_Minh', new Date('2026-10-02T17:24:00Z'))).toBe('2026-10-03');
    expect(todayIsoInZone('UTC', new Date('2026-10-02T17:24:00Z'))).toBe('2026-10-02');
  });

  it('is behind UTC in a western zone', () => {
    expect(todayIsoInZone('America/Los_Angeles', new Date('2026-10-03T06:00:00Z'))).toBe('2026-10-02');
  });
});
