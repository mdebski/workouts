import { assert, expect, test } from 'vitest';
import { decodeProgramme, encodeProgramme, extractPayload, sanitiseProgramme, shareUrl } from '../src/lib/share.ts';
import type { Programme } from '../src/lib/types.ts';

const programme: Programme = {
  id: 'p1', name: 'Pull day', emoji: '💪', archived: true,
  schedule: { start: '2026-11-02', repeat: { kind: 'weekdays', days: [1, 3, 5] }, end: { kind: 'count', n: 14 } },
  items: [
    { id: 'a', type: 'reps', name: 'Pull-ups', sets: 4, reps: 6, measure: 'weight', restBetweenSets: 90 },
    { id: 's', type: 'superset', rounds: 3, restBetweenRounds: 60, items: [
      { id: 'b', type: 'reps', name: 'Plank', sets: 1, reps: 1, measure: 'time' },
      { id: 'c', type: 'timed', name: 'Dead hang', sets: 1, reps: 6, workSec: 5, restSec: 5, trackWeight: false },
    ] },
    { id: 'd', type: 'activity', name: 'Warm-up', measure: 'time' },
  ],
};

const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' ? undefined : x)));

test('a programme survives the round trip through a link', async () => {
  const payload = await encodeProgramme(programme);
  assert.match(payload, /^[zj]\.[A-Za-z0-9_-]+$/, 'safe to put in a URL fragment');
  const back = await decodeProgramme(payload, '2026-11-16');
  assert.deepEqual(strip(back.items), strip(programme.items));
  assert.deepEqual(back.schedule.repeat, programme.schedule.repeat);
  assert.deepEqual(back.schedule.end, programme.schedule.end);
  assert.strictEqual(back.name, 'Pull day');
  assert.strictEqual(back.schedule.start, '2026-11-16', 'a start date in the past becomes today');
  assert.strictEqual(back.archived, false);
  assert.notStrictEqual(back.id, 'p1', 'ids are regenerated');
  assert.notStrictEqual((back.items[0] as { id: string }).id, 'a');
  assert.strictEqual(shareUrl(payload, 'https://example.test/app/#/programmes'), `https://example.test/app/#/add/${payload}`);
});

test('a pasted link or bare payload is recognised', () => {
  assert.strictEqual(extractPayload('  https://example.test/app/#/add/z.abc-DEF_123 \n'), 'z.abc-DEF_123');
  assert.strictEqual(extractPayload('j.abc'), 'j.abc');
  assert.strictEqual(extractPayload('Try this: https://example.test/#/add/z.abc'), 'z.abc');
  assert.strictEqual(extractPayload('https://example.test/#/programmes'), undefined);
  assert.strictEqual(extractPayload('hello'), undefined);
  assert.strictEqual(extractPayload(''), undefined);
});

test('untrusted input is rebuilt and clamped', () => {
  const p = sanitiseProgramme({
    name: '  ' + 'x'.repeat(500), emoji: 123, extra: '<script>', __proto__: { polluted: true },
    schedule: { start: 'yesterday', repeat: { kind: 'weekdays', days: [1, 1, 9, '3', 5] }, end: { kind: 'until', date: '2020-01-01' } },
    items: [{ type: 'reps', name: 'Squat', sets: 1e9, reps: -4, measure: 'bananas', restAfter: 'soon', onclick: 'x' }],
  }, '2026-11-16');
  assert.strictEqual(p.name.length, 80);
  assert.strictEqual(p.emoji, '💪');
  assert.strictEqual('extra' in p, false);
  assert.deepEqual(p.schedule, { start: '2026-11-16', repeat: { kind: 'weekdays', days: [1, 5] }, end: { kind: 'never' } });
  const ex = p.items[0];
  assert.deepEqual({ ...ex, id: '' }, { id: '', name: 'Squat', description: undefined, restAfter: undefined, type: 'reps', sets: 99, reps: 1, repScheme: undefined, measure: 'none', weightCount: undefined, restBetweenSets: undefined });
});

test('broken links are rejected', async () => {
  assert.throws(() => sanitiseProgramme(null, '2026-11-16'));
  assert.throws(() => sanitiseProgramme({ name: 'x', items: [], schedule: { repeat: { kind: 'weekdays', days: [] } } }, '2026-11-16'));
  assert.throws(() => sanitiseProgramme({ name: 'x', items: [{ type: 'laser', name: 'y' }], schedule: { repeat: { kind: 'interval', days: 1 } } }, '2026-11-16'));
  assert.throws(() => sanitiseProgramme({ name: '', items: [], schedule: { repeat: { kind: 'interval', days: 1 } } }, '2026-11-16'));
  await expect(decodeProgramme('q.abc', '2026-11-16')).rejects.toThrow();
  await expect(decodeProgramme('z.not-deflate', '2026-11-16')).rejects.toThrow();
  await expect(decodeProgramme('j.' + 'A'.repeat(30_000), '2026-11-16')).rejects.toThrow();
});
