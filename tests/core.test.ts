import { test } from 'vitest';
import assert from 'node:assert/strict';
import { addDays, diffDays, weekday } from '../src/lib/dates.ts';
import { describeRepeat, occurrences } from '../src/lib/schedule.ts';
import { copyValues, deleteProgramme, emptyData, flatten, migrate, neighbours, previousDone, slotInfo, statusOf, syncProgramme, topUp, HORIZON_DAYS } from '../src/lib/core.ts';
import type { Data, Item, Programme, Schedule, Workout } from '../src/lib/types.ts';

const take = <T>(g: Iterable<T>, n: number) => { const out: T[] = []; for (const v of g) { if (out.length >= n) break; out.push(v); } return out; };

const items = (): Item[] => [
  { id: 'pull', type: 'reps', name: 'Pull-ups', sets: 4, reps: 6, measure: 'weight', restBetweenSets: 90 },
  { id: 'ss', type: 'superset', rounds: 3, items: [
    { id: 'rows', type: 'reps', name: 'Rows', sets: 1, reps: 10, measure: 'weight' },
    { id: 'plank', type: 'reps', name: 'Plank', sets: 1, reps: 1, measure: 'time' },
  ] },
  { id: 'hang', type: 'timed', name: 'Dead hang', sets: 3, workSec: 30, restSec: 60, trackWeight: false },
  { id: 'warm', type: 'activity', name: 'Warm-up', measure: 'time', target: 15 },
];

const programme = (schedule: Schedule): Programme => ({ id: 'p1', name: 'Pull day', emoji: '💪', items: items(), schedule, archived: false });
const mwf: Schedule = { start: '2026-11-02', repeat: { kind: 'weekdays', days: [1, 3, 5] }, end: { kind: 'count', n: 14 } };
const withProgramme = (p: Programme, today: string): Data => { const d = emptyData(); d.programmes.push(p); syncProgramme(d, p, today, true); return d; };
const mine = (d: Data) => d.workouts.filter((w) => w.programmeId === 'p1').sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));

test('date helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26'); // DST change in the UK
  assert.equal(diffDays('2026-11-02', '2026-11-16'), 14);
  assert.equal(weekday('2026-11-16'), 1); // a Monday
  assert.equal(weekday('2026-11-22'), 7);
});

test('weekday and interval rules', () => {
  assert.deepEqual(take(occurrences(mwf), 4), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']);
  const every3: Schedule = { start: '2026-11-01', repeat: { kind: 'interval', days: 3 }, end: { kind: 'never' } };
  assert.deepEqual(take(occurrences(every3, '2026-11-05'), 2), ['2026-11-07', '2026-11-10']);
  assert.deepEqual(take(occurrences({ ...mwf, repeat: { kind: 'weekdays', days: [] } }), 1), []);
  assert.equal(describeRepeat(mwf), 'Mon, Wed, Fri');
});

test('a new programme generates every slot, including past ones', () => {
  const d = withProgramme(programme(mwf), '2026-11-16');
  const ws = mine(d);
  assert.equal(ws.length, 14);
  assert.equal(ws[0].date, '2026-11-02');
  assert.equal(ws.at(-1)!.date, '2026-12-02');
  assert.equal(statusOf(ws[0], '2026-11-16'), 'missed');
  assert.equal(statusOf(ws[6], '2026-11-16'), 'today');
  assert.equal(statusOf(ws[7], '2026-11-16'), 'planned');
  assert.deepEqual(slotInfo(d, ws[6]), { index: 7, total: 14 });
});

test('"until" and open-ended programmes', () => {
  const until = withProgramme(programme({ ...mwf, end: { kind: 'until', date: '2026-11-13' } }), '2026-11-02');
  assert.equal(mine(until).length, 6);
  const open = withProgramme(programme({ start: '2026-11-16', repeat: { kind: 'interval', days: 1 }, end: { kind: 'never' } }), '2026-11-16');
  assert.equal(mine(open).length, HORIZON_DAYS + 1);
  topUp(open, '2026-11-16');
  assert.equal(mine(open).length, HORIZON_DAYS + 1, 'top-up is idempotent');
  topUp(open, '2026-11-23');
  assert.equal(mine(open).length, HORIZON_DAYS + 8);
  assert.equal(new Set(mine(open).map((w) => w.scheduledDate)).size, HORIZON_DAYS + 8, 'no duplicate slots');
});

test('editing only changes future workouts and keeps the slot count', () => {
  const p = programme(mwf);
  const d = withProgramme(p, '2026-11-02');
  const ws = mine(d);
  Object.assign(ws[0], { status: 'done', completedAt: '2026-11-02T10:00:00Z' });
  ws[0].results.pull = { setsDone: 4, value: 10 };
  const doneId = ws[0].id;

  // On the 9th: slot 2 and 3 were missed. Change the plan to Tue/Thu and rename an exercise.
  p.schedule.repeat = { kind: 'weekdays', days: [2, 4] };
  (p.items[0] as { name: string }).name = 'Chin-ups';
  syncProgramme(d, p, '2026-11-09');

  const after = mine(d);
  assert.equal(after.length, 14, 'missed slots still count towards the 14');
  assert.equal(after[0].id, doneId);
  assert.equal((after[0].items[0] as { name: string }).name, 'Pull-ups', 'history keeps its snapshot');
  assert.deepEqual(after.slice(0, 3).map((w) => w.scheduledDate), ['2026-11-02', '2026-11-04', '2026-11-06']);
  assert.equal(after[3].scheduledDate, '2026-11-10');
  assert.equal((after[3].items[0] as { name: string }).name, 'Chin-ups');
  assert.ok(after.slice(3).every((w) => [2, 4].includes(weekday(w.scheduledDate!))));
});

test('a workout done early or moved keeps its slot', () => {
  const p = programme(mwf);
  const d = withProgramme(p, '2026-11-02');
  const wed = mine(d)[1];
  Object.assign(wed, { status: 'done', date: '2026-11-03', completedAt: '2026-11-03T10:00:00Z' });
  syncProgramme(d, p, '2026-11-03');
  const after = mine(d);
  assert.equal(after.length, 14);
  assert.equal(after.filter((w) => w.scheduledDate === '2026-11-04').length, 1, 'slot is not regenerated');
});

test('archiving and deleting', () => {
  const p = programme(mwf);
  const d = withProgramme(p, '2026-11-02');
  Object.assign(mine(d)[0], { status: 'done' });
  p.archived = true;
  syncProgramme(d, p, '2026-11-09');
  assert.equal(mine(d).length, 3, 'past slots stay, future ones go');
  p.archived = false;
  syncProgramme(d, p, '2026-11-09');
  assert.equal(mine(d).length, 14);
  deleteProgramme(d, 'p1', '2026-11-09');
  assert.equal(d.programmes.length, 0);
  assert.equal(d.workouts.length, 1, 'only completed history survives');
});

test('previous/next and copying values', () => {
  const d = withProgramme(programme(mwf), '2026-11-02');
  const [a, b, c] = mine(d);
  Object.assign(a, { status: 'done', completedAt: '2026-11-02T10:00:00Z' });
  a.results = { pull: { setsDone: 4, value: 12.5, feel: 'hard' }, plank: { setsDone: 3, value: 45 }, warm: { setsDone: 1 } };
  assert.equal(neighbours(d, b).prev, a);
  assert.equal(neighbours(d, b).next, c);
  assert.equal(neighbours(d, a).prev, undefined);
  assert.equal(previousDone(d, c), a, 'skips the unfinished workout in between');
  assert.equal(previousDone(d, a), undefined);

  // Exercise re-created with a new id still matches by name.
  (c.items[0] as { id: string }).id = 'pull-new';
  assert.equal(copyValues(c, a), 2);
  assert.equal(c.results['pull-new'].value, 12.5);
  assert.equal(c.results['pull-new'].feel, undefined, 'feel is not copied');
  assert.equal(c.results.plank.value, 45);
  assert.equal(c.results.rows, undefined);
});

test('flatten uses rounds for supersets', () => {
  assert.deepEqual(flatten(items()).map((f) => [f.ex.id, f.sets]), [['pull', 4], ['rows', 3], ['plank', 3], ['hang', 3], ['warm', 1]]);
});

test('migrate validates input', () => {
  const d = withProgramme(programme(mwf), '2026-11-02');
  assert.equal(migrate(JSON.parse(JSON.stringify(d))).workouts.length, 14);
  assert.throws(() => migrate(null));
  assert.throws(() => migrate({ version: 2, programmes: [], workouts: [] }));
  assert.throws(() => migrate({ version: 1, programmes: [], workouts: [{ id: 'x', date: 'tomorrow', items: [] }] }));
  assert.deepEqual(migrate({ version: 1, programmes: [], workouts: [], settings: { weightSteps: [] } }).settings.weightSteps, [1.25, 2.5, 5]);
});
