// What gets recorded for an exercise: a list of kinds (weight, time, grade…), and for
// each workout one value per entry of that list, in the same order.

import { formatDuration } from './duration.ts';
import type { Exercise, RecordKind, RecordValue, Result } from './types.ts';

/** Every kind, with extra words it can be found by when adding one. */
export const RECORD_KINDS: { id: RecordKind; label: string; words: string }[] = [
  { id: 'weight', label: 'Weight', words: 'kg load dumbbell barbell' },
  { id: 'time', label: 'Time', words: 'duration minutes seconds hold' },
  { id: 'count', label: 'Count', words: 'number reps times' },
  { id: 'distance', label: 'Distance', words: 'km run' },
  { id: 'route', label: 'Route grade', words: 'climbing lead sport french' },
  { id: 'boulder', label: 'Boulder grade', words: 'climbing v scale bouldering' },
  { id: 'note', label: 'Note', words: 'text comment' },
];

/** The kinds matching what was typed: every word must start a word of the name or its extra words. */
export function findKinds(query: string) {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  return RECORD_KINDS.filter((k) => {
    const words = `${k.label} ${k.words}`.toLowerCase().split(/\s+/);
    return q.every((part) => words.some((w) => w.startsWith(part)));
  });
}

export const isRecordKind = (v: unknown): v is RecordKind => RECORD_KINDS.some((k) => k.id === v);
export const kindLabel = (k: RecordKind) => RECORD_KINDS.find((r) => r.id === k)!.label;

/** French sport-climbing grades, easiest first. */
export const ROUTE_GRADES = ['3', '4a', '4b', '4c', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c'];
/** Bouldering grades on the V scale, easiest first. */
export const BOULDER_GRADES = ['VB', ...Array.from({ length: 18 }, (_, i) => `V${i}`)];

export const isGradeKind = (k: RecordKind): k is 'route' | 'boulder' => k === 'route' || k === 'boulder';
export const isNumberKind = (k: RecordKind): k is 'weight' | 'time' | 'count' | 'distance' => k === 'weight' || k === 'time' || k === 'count' || k === 'distance';
export const gradesOf = (k: 'route' | 'boulder') => (k === 'route' ? ROUTE_GRADES : BOULDER_GRADES);
/** A grade's place on its scale (higher is harder), or -1 if it isn't on it. */
export const gradeRank = (k: 'route' | 'boulder', g: string) => gradesOf(k).indexOf(g);

export type Unit = 'kg' | 's' | 'km' | '×';
export const unitOfKind = (k: RecordKind): Unit | null =>
  k === 'weight' ? 'kg' : k === 'time' ? 's' : k === 'distance' ? 'km' : k === 'count' ? '×' : null;

export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

/** One value with its unit: "42.5 kg", "1min 30s", "12×", "5.2 km", "7a+", or the note. */
export function fmtOne(k: RecordKind, v: RecordValue, withUnit = true): string {
  if (v === null || v === '') return '';
  if (typeof v === 'string') return v;
  if (k === 'time') return formatDuration(v);
  if (!withUnit) return fmtNum(v);
  return k === 'weight' ? `${fmtNum(v)} kg` : k === 'distance' ? `${fmtNum(v)} km` : `${fmtNum(v)}×`;
}

/** The values recorded in a result, padded or cut to the exercise's record list. */
export function valuesFor(ex: Exercise, r: Result | undefined): RecordValue[] {
  return ex.record.map((_, i) => r?.values?.[i] ?? null);
}

const isSet = (v: RecordValue | undefined) => v !== null && v !== undefined && v !== '';
export const hasRecorded = (r: Result | undefined) => !!r?.values?.some(isSet);

/** Running pace from a time and a distance, e.g. "5:12 /km", when both are recorded. */
export function paceOf(ex: Exercise, r: Result | undefined): string {
  const vs = valuesFor(ex, r);
  const time = vs[ex.record.indexOf('time')];
  const km = vs[ex.record.indexOf('distance')];
  if (typeof time !== 'number' || typeof km !== 'number' || time <= 0 || km <= 0) return '';
  const s = Math.round(time / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

/**
 * Everything recorded, in a few words: "42.5 kg", "10 / 12.5 kg · 7a+", "45min · 8 km · 5:38 /km".
 * Weights are grouped. Without units (for tables) when withUnit is false. Empty when nothing was recorded.
 */
export function fmtRecorded(ex: Exercise, r: Result | undefined, withUnit = true): string {
  const vs = valuesFor(ex, r);
  const parts: string[] = [];
  const weights = vs.filter((_, i) => ex.record[i] === 'weight');
  let weightsDone = false;
  ex.record.forEach((k, i) => {
    if (k === 'weight') {
      if (weightsDone || !weights.some(isSet)) return;
      weightsDone = true;
      const shown = weights.map((w) => (typeof w === 'number' ? fmtNum(w) : '–')).join(' / ');
      parts.push(withUnit ? `${shown} kg` : shown);
    } else if (isSet(vs[i])) {
      parts.push(fmtOne(k, vs[i], withUnit));
    }
  });
  const pace = paceOf(ex, r);
  if (pace) parts.push(pace);
  return parts.join(' · ');
}

/** "weight", "2 weights", "time, route grade": what gets recorded, for descriptions. */
export function describeRecord(record: RecordKind[]): string {
  const counts = new Map<RecordKind, number>();
  for (const k of record) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([k, n]) => {
    const word = kindLabel(k).toLowerCase();
    return n === 1 ? word : `${n} ${word}s`;
  }).join(', ');
}

/** The units shown beside an exercise's name in tables: "kg", "km, time", "grade". */
export function recordUnits(record: RecordKind[]): string {
  const words = record.map((k) => (k === 'weight' ? 'kg' : k === 'distance' ? 'km' : isGradeKind(k) ? 'grade' : k === 'note' ? '' : k));
  return [...new Set(words.filter(Boolean))].join(', ');
}

/**
 * What exercises recorded before this list of kinds existed. Older data had one setting per
 * type: `measure` on reps and activities, `trackWeight` on timed exercises.
 */
export function legacyRecord(ex: Record<string, unknown>): RecordKind[] {
  if (Array.isArray(ex.record)) return ex.record.filter(isRecordKind).slice(0, 12);
  if (ex.type === 'reps') {
    if (ex.measure === 'weight') return ['weight'];
    if (ex.measure === 'weights') {
      const scheme = Array.isArray(ex.repScheme) ? ex.repScheme.length : 0;
      const n = typeof ex.weightCount === 'number' ? ex.weightCount : scheme || 2;
      return Array.from({ length: Math.min(6, Math.max(2, Math.round(n))) }, () => 'weight' as const);
    }
    if (ex.measure === 'time') return ['time'];
    if (ex.measure === 'text') return ['note'];
    return [];
  }
  if (ex.type === 'timed') return ex.trackWeight === true ? ['weight'] : [];
  if (ex.type === 'activity') return [ex.measure === 'count' ? 'count' : ex.measure === 'distance' ? 'distance' : 'time'];
  return [];
}

/** A value from older data (one number, several weights or a note) as a list of values. */
export function legacyValues(ex: Record<string, unknown>, recorded: unknown): RecordValue[] | undefined {
  if (typeof recorded === 'number') {
    // Activities recorded time in minutes; it's seconds everywhere now.
    return [ex.type === 'activity' && ex.measure === 'time' ? Math.round(recorded * 60) : recorded];
  }
  if (Array.isArray(recorded)) return recorded.map((v) => (typeof v === 'number' ? v : null));
  if (typeof recorded === 'string' && recorded.trim()) return [recorded];
  return undefined;
}

/** Strips anything but numbers, strings and nulls, and fits the list to `record`. */
export function cleanValues(record: RecordKind[], raw: unknown): RecordValue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const vs = record.map((k, i) => {
    const v = raw[i];
    if (isNumberKind(k)) return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    return typeof v === 'string' && v.trim() ? v.slice(0, 500) : null;
  });
  return vs.some((v) => v !== null) ? vs : undefined;
}
