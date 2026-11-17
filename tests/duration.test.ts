import { assert, test } from 'vitest';
import { formatDuration, parseDuration } from '../src/lib/duration.ts';

test('bare numbers use the default unit', () => {
  assert.strictEqual(parseDuration('3'), 3);
  assert.strictEqual(parseDuration(' 90 '), 90);
  assert.strictEqual(parseDuration('2', 'min'), 120);
  assert.strictEqual(parseDuration('1,5', 'min'), 90);
});

test('units', () => {
  assert.strictEqual(parseDuration('45s'), 45);
  assert.strictEqual(parseDuration('5min'), 300);
  assert.strictEqual(parseDuration('5 MIN'), 300);
  assert.strictEqual(parseDuration('1.5 min'), 90);
  assert.strictEqual(parseDuration('1h'), 3600);
  assert.strictEqual(parseDuration('1h 30min'), 5400);
  assert.strictEqual(parseDuration('1m30s'), 90);
  assert.strictEqual(parseDuration('2 minutes 5 seconds'), 125);
  assert.strictEqual(parseDuration('45s', 'min'), 45, 'an explicit unit wins over the default');
});

test('clock notation', () => {
  assert.strictEqual(parseDuration('1:30'), 90);
  assert.strictEqual(parseDuration('0:05'), 5);
  assert.strictEqual(parseDuration('1:02:03'), 3723);
});

test('empty and unreadable input', () => {
  assert.strictEqual(parseDuration(''), undefined);
  assert.strictEqual(parseDuration('   '), undefined);
  for (const bad of ['abc', '5 parsecs', '1:75', 'min', '5min x', '-3']) assert.ok(Number.isNaN(parseDuration(bad)), bad);
});

test('formatting round-trips', () => {
  assert.strictEqual(formatDuration(45), '45s');
  assert.strictEqual(formatDuration(300), '5min');
  assert.strictEqual(formatDuration(90), '1min 30s');
  assert.strictEqual(formatDuration(4500), '1h 15min');
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(undefined), '');
  for (const s of [1, 59, 60, 61, 3599, 3600, 3661, 7325]) assert.strictEqual(parseDuration(formatDuration(s)), s);
});
