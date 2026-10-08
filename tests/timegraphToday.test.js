import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Exercise actual local calendar getters in separate processes so each zone
// is real and cannot leak into other tests or depend on the test runner's zone.
describe('timeline today follows the device time zone', () => {
  const cases = [
    ['America/Chicago', '2027-01-01T02:00:00Z', 2026, 12, 31],
    ['Pacific/Kiritimati', '2026-12-31T12:00:00Z', 2027, 1, 1],
    ['Asia/Kolkata', '2026-09-24T20:00:00Z', 2026, 9, 25],
    ['America/Chicago', '2028-03-01T02:00:00Z', 2028, 2, 29],
    ['America/Chicago', '2026-03-08T07:59:00Z', 2026, 3, 8],
    ['America/Chicago', '2026-03-08T08:01:00Z', 2026, 3, 8],
  ];
  for (const [zone, instant, year, month, day] of cases) {
    it(`${zone} at ${instant} yields ${year}-${month}-${day}`, () => {
      const moduleUrl = new URL('../src/lib/timegraph/timegraphDate.js', import.meta.url).href;
      const script = `import { todayPoint } from ${JSON.stringify(moduleUrl)};
        process.stdout.write(JSON.stringify(todayPoint(new Date(${JSON.stringify(instant)}))));`;
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8', env: { ...process.env, TZ: zone },
      });
      assert.deepEqual(JSON.parse(output), { year, month, day, precision: 'exact' });
    });
  }
});
