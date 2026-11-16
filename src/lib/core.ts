import { addDays, isISODate, maxISO } from './dates.ts';
import { occurrences } from './schedule.ts';
import type { Data, Exercise, ISODate, Item, Programme, Result, Workout } from './types.ts';

/** How far ahead open-ended programmes are generated. */
export const HORIZON_DAYS = 56;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const emptyData = (): Data => ({
  version: 1,
  programmes: [],
  workouts: [],
  settings: { weightSteps: [1.25, 2.5, 5] },
});

/** Accepts anything parsed from storage or an import file and returns valid data, or throws. */
export function migrate(raw: unknown): Data {
  if (!raw || typeof raw !== 'object') throw new Error('Not a workouts backup');
  const r = raw as Partial<Data>;
  if (r.version !== 1) throw new Error(`Unsupported backup version: ${String(r.version)}`);
  if (!Array.isArray(r.programmes) || !Array.isArray(r.workouts)) throw new Error('Backup is missing programmes or workouts');
  for (const w of r.workouts) {
    if (!w || typeof w.id !== 'string' || !isISODate(w.date) || !Array.isArray(w.items)) throw new Error('Backup contains a malformed workout');
    w.results ??= {};
  }
  for (const p of r.programmes) {
    if (!p || typeof p.id !== 'string' || !p.schedule || !isISODate(p.schedule.start) || !Array.isArray(p.items)) throw new Error('Backup contains a malformed programme');
  }
  const steps = r.settings?.weightSteps;
  const weightSteps = Array.isArray(steps) && steps.every((n) => typeof n === 'number' && n > 0) && steps.length ? steps : emptyData().settings.weightSteps;
  return { version: 1, programmes: r.programmes, workouts: r.workouts, settings: { weightSteps } };
}

// ---- Exercises -------------------------------------------------------------

export interface FlatExercise {
  ex: Exercise;
  /** Number of ticks: sets, or the superset's rounds. */
  sets: number;
  supersetId?: string;
}

export function flatten(items: Item[]): FlatExercise[] {
  return items.flatMap((it): FlatExercise[] =>
    it.type === 'superset'
      ? it.items.map((ex) => ({ ex, sets: it.rounds, supersetId: it.id }))
      : [{ ex: it, sets: it.type === 'activity' ? 1 : it.sets }],
  );
}

export type Unit = 'kg' | 's' | 'min' | '×';

/** The unit of the value recorded for an exercise, or null if nothing is recorded. */
export function unitOf(ex: Exercise): Unit | null {
  if (ex.type === 'reps') return ex.measure === 'weight' ? 'kg' : ex.measure === 'time' ? 's' : null;
  if (ex.type === 'timed') return ex.trackWeight ? 'kg' : null;
  return ex.measure === 'time' ? 'min' : '×';
}

export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

export function fmtValue(value: number | undefined, unit: Unit | null): string {
  if (unit === null) return '';
  if (value === undefined) return unit === '×' ? '—' : `— ${unit}`;
  return unit === '×' ? `${fmtNum(value)}×` : `${fmtNum(value)} ${unit}`;
}

export function fmtSecs(total: number): string {
  const s = Math.max(0, Math.ceil(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function describe(ex: Exercise, inSuperset = false): string {
  const rest = (n?: number) => (n ? ` · rest ${n} s` : '');
  if (ex.type === 'reps') {
    const what = ex.measure === 'time' ? (ex.reps === 1 ? 'hold' : `${ex.reps} holds`) : `${ex.reps} reps`;
    const sets = inSuperset ? what : `${ex.sets} × ${ex.measure === 'time' && ex.reps === 1 ? 'hold' : ex.reps}`;
    const m = ex.measure === 'none' ? '' : ` · ${ex.measure}`;
    return sets + m + (inSuperset ? '' : rest(ex.restBetweenSets));
  }
  if (ex.type === 'timed') {
    return `${inSuperset ? '' : `${ex.sets} × `}${ex.workSec} s on · ${ex.restSec} s off${ex.trackWeight ? ' · weight' : ''}`;
  }
  return `Activity · ${fmtNum(ex.target)}${ex.measure === 'time' ? ' min' : '×'}`;
}

export function resultOf(w: Workout, exId: string): Result {
  // Read the entry back after creating it: when `w` is reactive state, the stored
  // value is a proxy, and writes to the plain object we passed in would be lost.
  if (!w.results[exId]) w.results[exId] = { setsDone: 0 };
  return w.results[exId];
}

/** The recorded value, falling back to an activity's target. */
export function valueOf(w: Workout, ex: Exercise): number | undefined {
  return w.results[ex.id]?.value ?? (ex.type === 'activity' ? ex.target : undefined);
}

export function isComplete(w: Workout): boolean {
  return flatten(w.items).every(({ ex, sets }) => (w.results[ex.id]?.setsDone ?? 0) >= sets);
}

// ---- Workouts --------------------------------------------------------------

export type Status = 'done' | 'missed' | 'today' | 'planned';

export function statusOf(w: Workout, today: ISODate): Status {
  if (w.status === 'done') return 'done';
  return w.date < today ? 'missed' : w.date === today ? 'today' : 'planned';
}

const order = (a: Workout, b: Workout) =>
  a.date.localeCompare(b.date) || (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id);

/** Every workout sharing this one's name, oldest first. */
export function sameName(data: Data, w: Workout): Workout[] {
  return data.workouts.filter((o) => o.name === w.name).sort(order);
}

export function neighbours(data: Data, w: Workout): { prev?: Workout; next?: Workout } {
  const all = sameName(data, w);
  const i = all.findIndex((o) => o.id === w.id);
  return { prev: all[i - 1], next: all[i + 1] };
}

/** The most recent completed workout of the same name before this one. */
export function previousDone(data: Data, w: Workout): Workout | undefined {
  const all = sameName(data, w);
  const i = all.findIndex((o) => o.id === w.id);
  return all.slice(0, i).reverse().find((o) => o.status === 'done')
    ?? all.filter((o) => o.id !== w.id && o.status === 'done' && o.date <= w.date).at(-1);
}

/** Value recorded for the matching exercise (same id, else same name) in another workout. */
export function matchingValue(from: Workout | undefined, ex: Exercise): number | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items);
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name && unitOf(f.ex) === unitOf(ex));
  return match ? from.results[match.ex.id]?.value : undefined;
}

/** Copies every recorded value from `from`. Returns how many were copied. */
export function copyValues(w: Workout, from: Workout): number {
  let n = 0;
  for (const { ex } of flatten(w.items)) {
    if (unitOf(ex) === null) continue;
    const v = matchingValue(from, ex);
    if (v === undefined) continue;
    resultOf(w, ex.id).value = v;
    n++;
  }
  return n;
}

/** Position of a programme workout among its slots, e.g. 7 of 14. */
export function slotInfo(data: Data, w: Workout): { index: number; total?: number } | undefined {
  if (!w.programmeId || !w.scheduledDate) return undefined;
  const slots = data.workouts
    .filter((o) => o.programmeId === w.programmeId && o.scheduledDate)
    .sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));
  const p = data.programmes.find((p) => p.id === w.programmeId);
  return { index: slots.findIndex((o) => o.id === w.id) + 1, total: p?.schedule.end.kind === 'count' ? p.schedule.end.n : undefined };
}

export function durationMin(w: Workout): number | undefined {
  if (!w.startedAt || !w.completedAt) return undefined;
  return Math.max(1, Math.round((Date.parse(w.completedAt) - Date.parse(w.startedAt)) / 60_000));
}

// ---- Programmes ------------------------------------------------------------

function fromProgramme(p: Programme, date: ISODate): Workout {
  return { id: uid(), programmeId: p.id, name: p.name, emoji: p.emoji, scheduledDate: date, date, status: 'planned', items: clone(p.items), results: {} };
}

/**
 * Rebuilds a programme's planned workouts after it is created or edited.
 * Done, started and past (missed) workouts are kept and still use up their slot.
 */
export function syncProgramme(data: Data, p: Programme, today: ISODate, isNew = false): void {
  const keep = (w: Workout) => w.status === 'done' || !!w.startedAt || (w.scheduledDate ?? w.date) < today;
  const kept = data.workouts.filter((w) => w.programmeId === p.id && keep(w));
  data.workouts = data.workouts.filter((w) => w.programmeId !== p.id || keep(w));
  if (p.archived) return;

  const taken = new Set(kept.map((w) => w.scheduledDate));
  const { end } = p.schedule;
  let remaining = end.kind === 'count' ? end.n - kept.length : Infinity;
  const until = end.kind === 'until' ? end.date : end.kind === 'never' ? addDays(today, HORIZON_DAYS) : undefined;
  const from = isNew ? p.schedule.start : maxISO(p.schedule.start, today);

  for (const date of occurrences(p.schedule, from)) {
    if (remaining <= 0 || (until && date > until)) break;
    if (taken.has(date)) continue;
    data.workouts.push(fromProgramme(p, date));
    remaining--;
  }
}

/** Extends open-ended programmes up to the horizon. Safe to call on every launch. */
export function topUp(data: Data, today: ISODate): void {
  const horizon = addDays(today, HORIZON_DAYS);
  for (const p of data.programmes) {
    if (p.archived || p.schedule.end.kind !== 'never') continue;
    const dates = data.workouts.filter((w) => w.programmeId === p.id && w.scheduledDate).map((w) => w.scheduledDate!);
    const last = dates.sort().at(-1);
    const from = last ? maxISO(addDays(last, 1), today) : today;
    for (const date of occurrences(p.schedule, from)) {
      if (date > horizon) break;
      data.workouts.push(fromProgramme(p, date));
    }
  }
}

export function deleteProgramme(data: Data, id: string, today: ISODate): void {
  const p = data.programmes.find((p) => p.id === id);
  if (!p) return;
  p.archived = true;
  syncProgramme(data, p, today);
  // Missed slots go too; completed and started workouts stay as history.
  data.workouts = data.workouts.filter((w) => w.programmeId !== id || w.status === 'done' || !!w.startedAt);
  data.programmes = data.programmes.filter((p) => p.id !== id);
}
