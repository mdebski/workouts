import { assert, test } from 'vitest';
import { describe, emptyData, flatten, syncProgramme, restepProgramme } from '../src/lib/core.ts';
import { evenSteps, itemsAt, parseSteps, programmeSteps, setRepSteps, stepCount, stepLabel, weekStep } from '../src/lib/progression.ts';
import { decodeProgramme, encodeProgramme } from '../src/lib/share.ts';
import type { Data, Exercise, Item, Programme, Workout } from '../src/lib/types.ts';

const items = (): Item[] => [
  { id: 'squat', type: 'reps', name: 'Squat', sets: 3, reps: 6, record: ['weight'], steps: [{ reps: 6 }, { reps: 8 }, { reps: 10 }] },
  { id: 'ss', type: 'superset', rounds: 3, items: [
    { id: 'press', type: 'reps', name: 'Press', sets: 1, reps: 6, record: ['weight'], steps: [{ reps: 6 }, { reps: 7 }] },
    { id: 'gap', type: 'rest', seconds: 30 },
  ] },
  { id: 'pyramid', type: 'reps', name: 'Rows', sets: 3, reps: 6, repScheme: [6, 6, 5], record: ['weight'], steps: [{ reps: 6 }, { reps: 8 }] },
  { id: 'run', type: 'activity', name: 'Run', record: ['time'] },
];

// Mondays and Thursdays from Monday 2 November, for four weeks.
const programme = (unit: 'weeks' | 'workouts', every = 1): Programme => ({
  id: 'p1', name: 'Legs', emoji: '🦵', items: items(), archived: false,
  schedule: { start: '2026-11-02', repeat: { kind: 'weekdays', days: [1, 4] }, end: { kind: 'weeks', n: 4 } },
  progression: { unit, every },
});
const mine = (d: Data) => d.workouts.filter((w) => w.programmeId === 'p1').sort((a, b) => a.date.localeCompare(b.date));
const reps = (w: Workout, id: string) => (flatten(w.items).find((f) => f.ex.id === id)!.ex as Exercise & { reps: number }).reps;
const finish = (w: Workout) => { for (const { ex, sets } of flatten(w.items)) if (ex.type !== 'activity') (w.results[ex.id] ??= { setsDone: 0 }).setsDone = sets; w.results.run = { setsDone: 0, values: [1800] }; };
const plan = (p: Programme, today: string) => { const d = emptyData(); d.programmes.push(p); syncProgramme(d, p, today); return d; };

test('an exercise at a step: reps from its list, the last one holding, varying reps moving together', () => {
  const at = (step: number) => itemsAt(items(), step);
  const squat = (its: Item[]) => its[0] as Exercise & { reps: number };
  assert.strictEqual(squat(at(0)).reps, 6);
  assert.strictEqual(squat(at(2)).reps, 10);
  assert.strictEqual(squat(at(7)).reps, 10);
  assert.ok(!('steps' in squat(at(1))));
  const rows = at(1)[2] as Exercise & { repScheme: number[] };
  assert.deepEqual(rows.repScheme, [8, 8, 7]);
  assert.strictEqual((at(5)[1] as { items: Item[] }).items[0].type === 'reps' && ((at(5)[1] as { items: (Exercise & { reps: number })[] }).items[0]).reps, 7);
  // No progression: the lists are dropped and nothing changes.
  assert.strictEqual(squat(itemsAt(items(), undefined)).reps, 6);
  assert.ok(!('steps' in squat(itemsAt(items(), undefined))));
  assert.strictEqual(stepCount(items()), 3);
});

test('by weeks: each workout gets the step of its week', () => {
  const d = plan(programme('weeks'), '2026-11-01');
  const ws = mine(d);
  assert.strictEqual(ws.length, 8);
  assert.deepEqual(ws.map((w) => w.step), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(ws.map((w) => reps(w, 'squat')), [6, 6, 8, 8, 10, 10, 10, 10]);
  assert.deepEqual(ws.map((w) => reps(w, 'press')), [6, 6, 7, 7, 7, 7, 7, 7]);
  // Every two weeks.
  assert.deepEqual(mine(plan(programme('weeks', 2), '2026-11-01')).map((w) => w.step), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.strictEqual(weekStep(programme('weeks'), '2026-11-15'), 1);
});

test('by workouts done: missed ones hold the step, upcoming ones assume they get done', () => {
  const p = programme('workouts');
  const d = plan(p, '2026-11-01');
  assert.deepEqual(mine(d).map((w) => w.step), [0, 1, 2, 3, 4, 5, 6, 7]);
  // Done the first, missed the second; it's now Monday 9 November.
  finish(mine(d)[0]);
  restepProgramme(d, p, '2026-11-09');
  assert.deepEqual(mine(d).map((w) => w.step), [0, 1, 1, 2, 3, 4, 5, 6]);
  // Every 2 workouts done.
  const p2 = programme('workouts', 2);
  assert.deepEqual(mine(plan(p2, '2026-11-01')).map((w) => w.step), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('a workout with anything entered keeps its exercises', () => {
  const p = programme('weeks');
  const d = plan(p, '2026-11-01');
  const second = mine(d)[2];
  second.results.squat = { setsDone: 1 };
  p.items = itemsAt(items(), undefined); // lists gone: everything at the base reps
  syncProgramme(d, p, '2026-11-01');
  assert.strictEqual(reps(mine(d)[2], 'squat'), 8);
  assert.strictEqual(reps(mine(d)[3], 'squat'), 6);
});

test('describing and parsing', () => {
  const squat = items()[0] as Exercise;
  assert.strictEqual(describe(squat, false, false), '3 × 6→10');
  assert.deepEqual(parseSteps('6, 8,10 12'), [6, 8, 10, 12]);
  const ex = { ...(items()[0] as Exercise), steps: undefined } as Exercise;
  setRepSteps(ex, [5, 7]);
  assert.deepEqual(ex.steps, [{ reps: 5 }, { reps: 7 }]);
  assert.strictEqual((ex as { reps: number }).reps, 5);
  assert.strictEqual(stepLabel({ unit: 'weeks', every: 1 }, 2), 'Week 3');
  assert.strictEqual(stepLabel({ unit: 'workouts', every: 1 }, 0), 'Step 1');
});

test('share links carry the progression', async () => {
  const back = await decodeProgramme(await encodeProgramme(programme('weeks', 2)), '2026-11-01');
  assert.deepEqual(back.progression, { unit: 'weeks', every: 2 });
  assert.deepEqual((back.items[0] as Exercise).steps, [{ reps: 6 }, { reps: 8 }, { reps: 10 }]);
});

test('the same reps added each step, through to the end of the programme', () => {
  const p = programme('weeks');
  assert.strictEqual(programmeSteps(p.schedule, { unit: 'weeks', every: 1 }), 4);
  assert.strictEqual(programmeSteps(p.schedule, { unit: 'weeks', every: 2 }), 2);
  assert.strictEqual(programmeSteps(p.schedule, { unit: 'workouts', every: 1 }), 8);
  assert.strictEqual(programmeSteps(p.schedule, { unit: 'workouts', every: 3 }), 3);
  assert.strictEqual(programmeSteps({ ...p.schedule, end: { kind: 'count', n: 5 } }, { unit: 'workouts', every: 1 }), 5);
  assert.strictEqual(programmeSteps({ ...p.schedule, end: { kind: 'never' } }, { unit: 'weeks', every: 1 }), undefined);
  assert.deepEqual(evenSteps(6, 2, 4), [6, 8, 10, 12]);
  assert.deepEqual(evenSteps(3, -1, 4), [3, 2, 1, 1]);
});
