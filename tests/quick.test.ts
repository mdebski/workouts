import { assert, test } from 'vitest';
import { parseQuick, parseQuickLine } from '../src/lib/quick.ts';
import type { QuickDefaults } from '../src/lib/quick.ts';

const d: QuickDefaults = { sets: 3, reps: 10, record: ['weight'], restBetweenSets: 90 };
const p = (line: string) => { const { id: _id, ...rest } = parseQuickLine(line, d)!; return rest; };

test('shorthand lines', () => {
  assert.deepEqual(p('Pull-ups 4x6'), { name: 'Pull-ups', type: 'reps', sets: 4, reps: 6, record: ['weight'], restBetweenSets: 90 });
  assert.deepEqual(p('Push ups 3 × 12'), { name: 'Push ups', type: 'reps', sets: 3, reps: 12, record: ['weight'], restBetweenSets: 90 });
  assert.deepEqual(p('Plank 3x hold'), { name: 'Plank', type: 'reps', sets: 3, reps: 1, record: ['time'] });
  assert.deepEqual(p('Dead hang 6x5/5'), { name: 'Dead hang', type: 'timed', reps: 6, workSec: 5, restSec: 5, record: [] });
  assert.deepEqual(p('Dead hang 3x6x7s/3s'), { name: 'Dead hang', type: 'timed', reps: 18, workSec: 7, restSec: 3, record: [] });
  assert.deepEqual(p('Warm-up min'), { name: 'Warm-up', type: 'activity', record: ['time'] });
  assert.deepEqual(p('Stretch: 7,5min'), { name: 'Stretch', type: 'activity', record: ['time'] });
  assert.deepEqual(p('Jumping jacks count'), { name: 'Jumping jacks', type: 'activity', record: ['count'] });
  assert.deepEqual(p('Run km'), { name: 'Run', type: 'activity', record: ['distance'] });
  assert.deepEqual(p('Bike 12.5 km'), { name: 'Bike', type: 'activity', record: ['distance'] });
  assert.deepEqual(p('Burpees x20'), { name: 'Burpees', type: 'activity', record: ['count'] });
});

test('varying reps', () => {
  assert.deepEqual(p('Bench 5;5;10'), { name: 'Bench', type: 'reps', sets: 3, reps: 5, repScheme: [5, 5, 10], record: ['weight'], restBetweenSets: 90 });
  assert.deepEqual((p('Rows 6/4/2/2') as { repScheme?: number[] }).repScheme, [6, 4, 2, 2]);
});

test('a bare name takes the defaults', () => {
  assert.deepEqual(p('Rows'), { name: 'Rows', type: 'reps', ...d });
  assert.deepEqual(p('  - Face pulls'), { name: 'Face pulls', type: 'reps', ...d });
  assert.deepEqual((p('2. Curls 3x8') as { name: string }).name, 'Curls');
  assert.deepEqual(p('Rest 90s'), { type: 'rest', seconds: 90 });
  assert.deepEqual(p('rest: 2min'), { type: 'rest', seconds: 120 });
});

test('several lines, blanks skipped, values clamped', () => {
  const list = parseQuick('Pull-ups 4x6\n\n   \nRows\nSquats 500x5000', d);
  assert.deepEqual(list.map((e) => (e.type === 'rest' ? 'rest' : e.name)), ['Pull-ups', 'Rows', 'Squats']);
  assert.strictEqual(new Set(list.map((e) => e.id)).size, 3);
  assert.deepEqual([(list[2] as { sets: number }).sets, (list[2] as { reps: number }).reps], [99, 999]);
  assert.strictEqual(parseQuickLine('', d), undefined);
});
