import { assert, test } from 'vitest';
import { addDays, diffDays, weekday } from '../src/lib/dates.ts';
import { describeEnd, describeRepeat, occurrences } from '../src/lib/schedule.ts';
import { copyValues, deleteProgramme, describe, fmtRecorded, mergeData, exerciseNames, searchExercises, fmtValues, valuesOf, emptyData, flatten, migrate, neighbours, previousDone, slotInfo, statusOf, syncProgramme, topUp, HORIZON_DAYS } from '../src/lib/core.ts';
import type { Data, Exercise, Item, Programme, Schedule, Workout } from '../src/lib/types.ts';

const take = <T>(g: Iterable<T>, n: number) => { const out: T[] = []; for (const v of g) { if (out.length >= n) break; out.push(v); } return out; };

const items = (): Item[] => [
  { id: 'pull', type: 'reps', name: 'Pull-ups', sets: 4, reps: 6, measure: 'weight', restBetweenSets: 90 },
  { id: 'ss', type: 'superset', rounds: 3, items: [
    { id: 'rows', type: 'reps', name: 'Rows', sets: 1, reps: 10, measure: 'weight' },
    { id: 'plank', type: 'reps', name: 'Plank', sets: 1, reps: 1, measure: 'time' },
  ] },
  { id: 'hang', type: 'timed', name: 'Dead hang', reps: 6, workSec: 5, restSec: 5, trackWeight: false },
  { id: 'warm', type: 'activity', name: 'Warm-up', measure: 'time' },
];

const programme = (schedule: Schedule): Programme => ({ id: 'p1', name: 'Pull day', emoji: '💪', items: items(), schedule: structuredClone(schedule), archived: false });
const mwf: Schedule = { start: '2026-11-02', repeat: { kind: 'weekdays', days: [1, 3, 5] }, end: { kind: 'count', n: 14 } };
const withProgramme = (p: Programme, today: string): Data => { const d = emptyData(); d.programmes.push(p); syncProgramme(d, p, today, true); return d; };
const mine = (d: Data) => d.workouts.filter((w) => w.programmeId === 'p1').sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));

test('date helpers', () => {
  assert.strictEqual(addDays('2026-02-28', 1), '2026-03-01');
  assert.strictEqual(addDays('2026-10-25', 1), '2026-10-26'); // DST change in the UK
  assert.strictEqual(diffDays('2026-11-02', '2026-11-16'), 14);
  assert.strictEqual(weekday('2026-11-16'), 1); // a Monday
  assert.strictEqual(weekday('2026-11-22'), 7);
});

test('weekday and interval rules', () => {
  assert.deepEqual(take(occurrences(mwf), 4), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']);
  const every3: Schedule = { start: '2026-11-01', repeat: { kind: 'interval', days: 3 }, end: { kind: 'never' } };
  assert.deepEqual(take(occurrences(every3, '2026-11-05'), 2), ['2026-11-07', '2026-11-10']);
  assert.deepEqual(take(occurrences({ ...mwf, repeat: { kind: 'weekdays', days: [] } }), 1), []);
  assert.strictEqual(describeRepeat(mwf), 'Mon, Wed, Fri');
});

test('a new programme generates every slot, including past ones', () => {
  const d = withProgramme(programme(mwf), '2026-11-16');
  const ws = mine(d);
  assert.strictEqual(ws.length, 14);
  assert.strictEqual(ws[0].date, '2026-11-02');
  assert.strictEqual(ws.at(-1)!.date, '2026-12-02');
  assert.strictEqual(statusOf(ws[0], '2026-11-16'), 'missed');
  assert.strictEqual(statusOf(ws[6], '2026-11-16'), 'today');
  assert.strictEqual(statusOf(ws[7], '2026-11-16'), 'planned');
  assert.deepEqual(slotInfo(d, ws[6]), { index: 7, total: 14 });
});

test('"until" and open-ended programmes', () => {
  const until = withProgramme(programme({ ...mwf, end: { kind: 'until', date: '2026-11-13' } }), '2026-11-02');
  assert.strictEqual(mine(until).length, 6);
  const open = withProgramme(programme({ start: '2026-11-16', repeat: { kind: 'interval', days: 1 }, end: { kind: 'never' } }), '2026-11-16');
  assert.strictEqual(mine(open).length, HORIZON_DAYS + 1);
  topUp(open, '2026-11-16');
  assert.strictEqual(mine(open).length, HORIZON_DAYS + 1, 'top-up is idempotent');
  topUp(open, '2026-11-23');
  assert.strictEqual(mine(open).length, HORIZON_DAYS + 8);
  assert.strictEqual(new Set(mine(open).map((w) => w.scheduledDate)).size, HORIZON_DAYS + 8, 'no duplicate slots');
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
  assert.strictEqual(after.length, 14, 'missed slots still count towards the 14');
  assert.strictEqual(after[0].id, doneId);
  assert.strictEqual((after[0].items[0] as { name: string }).name, 'Pull-ups', 'history keeps its snapshot');
  assert.deepEqual(after.slice(0, 3).map((w) => w.scheduledDate), ['2026-11-02', '2026-11-04', '2026-11-06']);
  assert.strictEqual(after[3].scheduledDate, '2026-11-10');
  assert.strictEqual((after[3].items[0] as { name: string }).name, 'Chin-ups');
  assert.ok(after.slice(3).every((w) => [2, 4].includes(weekday(w.scheduledDate!))));
});

test('a workout done early or moved keeps its slot', () => {
  const p = programme(mwf);
  const d = withProgramme(p, '2026-11-02');
  const wed = mine(d)[1];
  Object.assign(wed, { status: 'done', date: '2026-11-03', completedAt: '2026-11-03T10:00:00Z' });
  syncProgramme(d, p, '2026-11-03');
  const after = mine(d);
  assert.strictEqual(after.length, 14);
  assert.strictEqual(after.filter((w) => w.scheduledDate === '2026-11-04').length, 1, 'slot is not regenerated');
});

test('a programme can end after a number of weeks', () => {
  const d = withProgramme(programme({ ...mwf, end: { kind: 'weeks', n: 2 } }), '2026-11-02');
  assert.deepEqual(mine(d).map((w) => w.date), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-13']);
  assert.strictEqual(describeEnd({ ...mwf, end: { kind: 'weeks', n: 2 } }), 'for 2 weeks');
  assert.strictEqual(describe(items()[2] as Exercise), '6 × 5s / 5s');
});

test('old timed exercises become plain rounds', () => {
  const old = { version: 1, programmes: [], workouts: [{ id: 'w', date: '2026-11-02', name: 'x', emoji: 'x', status: 'done', items: [
    { id: 'a', type: 'timed', name: 'Hang', sets: 6, workSec: 5, restSec: 5, trackWeight: false },
    { id: 'b', type: 'timed', name: 'Hang', sets: 3, reps: 2, workSec: 5, restSec: 5, trackWeight: false, restBetweenSets: 60 },
    { id: 's', type: 'superset', rounds: 2, items: [{ id: 'c', type: 'timed', name: 'Hang', sets: 1, reps: 4, workSec: 5, restSec: 5, trackWeight: false }] },
  ], results: { a: { setsDone: 6 }, b: { setsDone: 2 }, c: { setsDone: 2 } } }] };
  const d = migrate(old);
  const [a, b, s] = d.workouts[0].items as unknown as [Record<string, unknown>, Record<string, unknown>, { items: Record<string, unknown>[] }];
  assert.deepEqual([a.reps, b.reps, s.items[0].reps], [6, 6, 4]);
  assert.ok(!('sets' in a) && !('sets' in b) && !('restBetweenSets' in b));
  assert.deepEqual(['a', 'b', 'c'].map((k) => d.workouts[0].results[k].setsDone), [6, 4, 2], 'done sets become done rounds, except in supersets');
});

test('old activity targets become recorded values', () => {
  const act = (id: string) => ({ id, type: 'activity', name: 'Warm-up', measure: 'time', target: 15 });
  const old = { version: 1, programmes: [], workouts: [
    { id: 'a', date: '2026-11-02', name: 'x', emoji: 'x', status: 'done', items: [act('w')], results: { w: { setsDone: 1 } } },
    { id: 'b', date: '2026-11-03', name: 'x', emoji: 'x', status: 'done', items: [act('w')], results: { w: { setsDone: 1, value: 20 } } },
    { id: 'c', date: '2026-11-04', name: 'x', emoji: 'x', status: 'planned', items: [act('w')], results: {} },
  ] };
  const d = migrate(old);
  assert.deepEqual(d.workouts.map((w) => w.results.w?.value), [15, 20, undefined]);
  assert.ok(d.workouts.every((w) => !('target' in w.items[0])));
});

test('archiving and deleting', () => {
  const p = programme(mwf);
  const d = withProgramme(p, '2026-11-02');
  Object.assign(mine(d)[0], { status: 'done' });
  p.archived = true;
  syncProgramme(d, p, '2026-11-09');
  assert.strictEqual(mine(d).length, 3, 'past slots stay, future ones go');
  p.archived = false;
  syncProgramme(d, p, '2026-11-09');
  assert.strictEqual(mine(d).length, 14);
  deleteProgramme(d, 'p1', '2026-11-09');
  assert.strictEqual(d.programmes.length, 0);
  assert.strictEqual(d.workouts.length, 1, 'only completed history survives');
});

test('previous/next and copying values', () => {
  const d = withProgramme(programme(mwf), '2026-11-02');
  const [a, b, c] = mine(d);
  Object.assign(a, { status: 'done', completedAt: '2026-11-02T10:00:00Z' });
  a.results = { pull: { setsDone: 4, value: 12.5, feel: 'hard' }, plank: { setsDone: 3, value: 45 }, warm: { setsDone: 1 } };
  assert.strictEqual(neighbours(d, b).prev, a);
  assert.strictEqual(neighbours(d, b).next, c);
  assert.strictEqual(neighbours(d, a).prev, undefined);
  assert.strictEqual(previousDone(d, c), a, 'skips the unfinished workout in between');
  assert.strictEqual(previousDone(d, a), undefined);

  // Exercise re-created with a new id still matches by name.
  (c.items[0] as { id: string }).id = 'pull-new';
  assert.strictEqual(copyValues(c, a), 2);
  assert.strictEqual(c.results['pull-new'].value, 12.5);
  assert.strictEqual(c.results['pull-new'].feel, undefined, 'feel is not copied');
  assert.strictEqual(c.results.plank.value, 45);
  assert.strictEqual(c.results.rows, undefined);

  // The dumbbell flag travels with the weight.
  a.results.pull.dumbbells = true;
  copyValues(c, a);
  assert.strictEqual(c.results['pull-new'].dumbbells, true);
  delete a.results.pull.dumbbells;
  copyValues(c, a);
  assert.strictEqual(c.results['pull-new'].dumbbells, undefined);
});

test('text notes are copied from the previous workout', () => {
  const p = programme(mwf);
  p.items.push({ id: 'band', type: 'reps', name: 'Band pull-aparts', sets: 2, reps: 15, measure: 'text' });
  const d = withProgramme(p, '2026-11-02');
  const [a, b] = mine(d);
  Object.assign(a, { status: 'done' });
  a.results = { band: { setsDone: 2, text: 'red band' }, pull: { setsDone: 4, value: 10 } };
  assert.strictEqual(copyValues(b, a), 2);
  assert.strictEqual(b.results.band.text, 'red band');
  assert.strictEqual(describe(p.items.at(-1) as Exercise), '2 × 15 · notes');
});

test('several weights and varying reps', () => {
  const p = programme(mwf);
  p.items.push({ id: 'dl', type: 'reps', name: 'Deadlift', sets: 3, reps: 5, repScheme: [5, 5, 10], measure: 'weights' });
  const d = withProgramme(p, '2026-11-02');
  const [a, b] = mine(d);
  Object.assign(a, { status: 'done' });
  a.results = { dl: { setsDone: 3, values: [80, 80, 65] } };
  const ex = p.items.at(-1) as Exercise;
  assert.strictEqual(describe(ex), '5 / 5 / 10 reps · 3 weights');
  assert.deepEqual(valuesOf(b, ex), [null, null, null]);
  assert.strictEqual(copyValues(b, a), 1);
  assert.deepEqual(valuesOf(b, ex), [80, 80, 65]);
  assert.strictEqual(fmtValues([115, null]), '115 / –');
});

test('exercise search', () => {
  const d = withProgramme(programme(mwf), '2026-11-02');
  const [a, b, c] = mine(d);
  Object.assign(a, { status: 'done' }); a.results = { pull: { setsDone: 4, value: 10 } };
  Object.assign(b, { status: 'done' }); b.results = { pull: { setsDone: 4, value: 12.5, feel: 'hard' } };
  d.workouts.push({ id: 'o', name: 'Gym', emoji: 'x', date: '2026-11-05', status: 'done', results: {}, items: [{ id: 'q', type: 'reps', name: 'Pull-Ups ', sets: 3, reps: 5, measure: 'none' }] });
  void c; // planned, so never found
  const g = searchExercises(d, '  PULL ');
  assert.strictEqual(g.length, 1, 'names match regardless of case and spacing');
  assert.deepEqual(g[0].entries.map((e) => [e.workout.date, e.result?.value]), [['2026-11-05', undefined], ['2026-11-04', 12.5], ['2026-11-02', 10]]);
  assert.deepEqual(searchExercises(d, 'dead hng'), []);
  assert.deepEqual(searchExercises(d, 'dead hang').map((x) => x.entries.length), [2]);
  assert.deepEqual(searchExercises(d, 'up pull').map((x) => x.name), ['Pull-Ups'], 'every word, in any order');
  assert.deepEqual(searchExercises(d, ''), []);
  assert.deepEqual(searchExercises(d, 'pull', 'value')[0].entries.map((e) => e.result?.value), [12.5, 10, undefined], 'highest first, unrecorded last');
  // Made-up name: one accented letter (é) and the non-decomposing letters ł and ø.
  d.workouts[0].items.push({ id: 'm', type: 'reps', name: 'Café łift øver', sets: 3, reps: 8, measure: 'weight' });
  assert.strictEqual(searchExercises(d, 'cafe lift over').length, 1, 'accents, ł and ø are ignored');
  assert.ok(exerciseNames(d).includes('Warm-up'));
});

test('merging a backup adds what is missing and keeps what is here', () => {
  const here = withProgramme(programme(mwf), '2026-11-02');
  const there = withProgramme(programme(mwf), '2026-11-02'); // same programme, set up on another device
  const [h0, h1] = mine(here);
  const [t0, t1, t2] = mine(there);
  Object.assign(h0, { status: 'done' }); h0.results = { pull: { setsDone: 4, value: 10 } };
  Object.assign(t0, { status: 'done' }); t0.results = { pull: { setsDone: 4, value: 99 } };
  Object.assign(t1, { status: 'done' }); t1.results = { pull: { setsDone: 4, value: 12.5 } };
  void t2;
  const past = { id: 'old', name: 'Gym 2024', emoji: 'x', date: '2024-03-01', status: 'done' as const, results: {}, items: [] };
  const otherProgramme = { ...programme(mwf), id: 'p2', name: 'Legs' };
  there.workouts.push(past);
  there.programmes.push(otherProgramme);
  there.settings.weightSteps = [10];

  const s = mergeData(here, structuredClone(there));
  assert.deepEqual(s, { programmesAdded: 1, workoutsAdded: 1, workoutsUpdated: 1, skipped: 13 });
  assert.strictEqual(here.workouts.length, 15);
  assert.strictEqual(mine(here).length, 14, 'no duplicate slots');
  assert.strictEqual(here.workouts.find((w) => w.scheduledDate === '2026-11-02')!.results.pull.value, 10, 'both done: ours kept');
  assert.strictEqual(mine(here)[1].results.pull.value, 12.5, 'only theirs done: theirs taken');
  assert.notStrictEqual(mine(here)[1].id, h1.id);
  assert.deepEqual(here.settings.weightSteps, [1.25, 2.5, 5]);

  const again = mergeData(here, structuredClone(there));
  assert.deepEqual(again, { programmesAdded: 0, workoutsAdded: 0, workoutsUpdated: 0, skipped: 15 }, 'importing twice changes nothing');
});

test('recorded values in a few words', () => {
  const reps = (measure: string) => ({ id: 'x', type: 'reps', name: 'X', sets: 3, reps: 5, measure }) as Exercise;
  const act = (measure: string) => ({ id: 'x', type: 'activity', name: 'X', measure }) as Exercise;
  assert.strictEqual(fmtRecorded(reps('weight'), { setsDone: 3, value: 42.5 }), '42.5 kg');
  assert.strictEqual(fmtRecorded({ ...reps('weights'), weightCount: 2 } as Exercise, { setsDone: 3, values: [10, 12.5] }), '10 / 12.5 kg');
  assert.strictEqual(fmtRecorded(reps('time'), { setsDone: 3, value: 70 }), '1min 10s');
  assert.strictEqual(fmtRecorded(reps('text'), { setsDone: 3, text: 'blue' }), 'blue');
  assert.strictEqual(fmtRecorded(act('distance'), { setsDone: 1, value: 5.4 }), '5.4 km');
  assert.strictEqual(fmtRecorded(act('time'), { setsDone: 1, value: 75 }), '1h 15min');
  assert.strictEqual(fmtRecorded(act('count'), { setsDone: 1, value: 30 }), '30 times');
  assert.strictEqual(fmtRecorded(reps('none'), { setsDone: 3 }), '');
  assert.strictEqual(fmtRecorded(reps('weight'), undefined), '');
});

test('flatten uses rounds for supersets', () => {
  assert.deepEqual(flatten(items()).map((f) => [f.ex.id, f.sets]), [['pull', 4], ['rows', 3], ['plank', 3], ['hang', 6], ['warm', 1]]);
});

test('migrate validates input', () => {
  const d = withProgramme(programme(mwf), '2026-11-02');
  assert.strictEqual(migrate(JSON.parse(JSON.stringify(d))).workouts.length, 14);
  assert.throws(() => migrate(null));
  assert.throws(() => migrate({ version: 2, programmes: [], workouts: [] }));
  assert.throws(() => migrate({ version: 1, programmes: [], workouts: [{ id: 'x', date: 'tomorrow', items: [] }] }));
  assert.deepEqual(migrate({ version: 1, programmes: [], workouts: [], settings: { weightSteps: [] } }).settings.weightSteps, [1.25, 2.5, 5]);
});
