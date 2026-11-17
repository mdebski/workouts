import { addDays, isISODate, maxISO } from './dates.ts';
import { lastDay, occurrences } from './schedule.ts';
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
  // Timed exercises used to be `sets` × (work, rest). They are now sets of `reps` such rounds.
  const upgrade = (items: Item[]) => {
    for (const it of items) {
      if (it.type === 'superset') upgrade(it.items);
      else if (it.type === 'timed' && typeof it.reps !== 'number') Object.assign(it, { reps: it.sets, sets: 1 });
    }
  };
  for (const holder of [...r.programmes, ...r.workouts]) upgrade(holder.items);
  // Activities used to carry a preset amount. It is now only ever recorded, so keep
  // it as the recorded value where the activity was done, then drop it.
  const untarget = (items: Item[], results?: Data['workouts'][number]['results']) => {
    for (const it of items) {
      if (it.type === 'superset') untarget(it.items, results);
      else if (it.type === 'activity' && 'target' in it) {
        const done = results?.[it.id];
        if (done && done.setsDone > 0 && done.value === undefined && typeof it.target === 'number') done.value = it.target;
        delete it.target;
      }
    }
  };
  for (const p of r.programmes) untarget(p.items);
  for (const w of r.workouts) untarget(w.items, w.results);
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
  if (ex.type === 'reps') return ex.measure === 'weight' || ex.measure === 'weights' ? 'kg' : ex.measure === 'time' ? 's' : null;
  if (ex.type === 'timed') return ex.trackWeight ? 'kg' : null;
  return ex.measure === 'time' ? 'min' : '×';
}

/** Whether the exercise records a weight in kg, so a dumbbell flag makes sense. */
export const recordsKg = (ex: Exercise) => unitOf(ex) === 'kg';

/** Carries the dumbbell flag over from another workout's result. */
function copyDumbbells(w: Workout, from: Workout, ex: Exercise) {
  const flat = flatten(from.items);
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name && unitOf(f.ex) === 'kg');
  const r = resultOf(w, ex.id);
  if (match && from.results[match.ex.id]?.dumbbells) r.dumbbells = true;
  else delete r.dumbbells;
}

export const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

export function fmtValue(value: number | undefined, unit: Unit | null): string {
  if (unit === null) return '';
  if (value === undefined) return `— ${unit}`;
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
    const sets = ex.repScheme?.length ? `${ex.repScheme.join(' / ')} reps` : inSuperset ? what : `${ex.sets} × ${ex.measure === 'time' && ex.reps === 1 ? 'hold' : ex.reps}`;
    const m = ex.measure === 'none' ? '' : ex.measure === 'text' ? ' · notes' : ex.measure === 'weights' ? ` · ${weightCountOf(ex)} weights` : ` · ${ex.measure}`;
    return sets + m + (inSuperset ? '' : rest(ex.restBetweenSets));
  }
  if (ex.type === 'timed') {
    const sets = inSuperset || ex.sets === 1 ? '' : `${ex.sets} sets of `;
    return `${sets}${ex.reps} × ${ex.workSec} s on, ${ex.restSec} s off${ex.trackWeight ? ' · weight' : ''}${inSuperset ? '' : rest(ex.restBetweenSets)}`;
  }
  return ex.measure === 'time' ? 'Activity · record minutes' : 'Activity · record a count';
}

export function resultOf(w: Workout, exId: string): Result {
  // Read the entry back after creating it: when `w` is reactive state, the stored
  // value is a proxy, and writes to the plain object we passed in would be lost.
  if (!w.results[exId]) w.results[exId] = { setsDone: 0 };
  return w.results[exId];
}

/** The value recorded for an exercise in this workout, if any. */
export function valueOf(w: Workout, ex: Exercise): number | undefined {
  return w.results[ex.id]?.value;
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

export const recordsWeights = (ex: Exercise): ex is Extract<Exercise, { type: 'reps' }> => ex.type === 'reps' && ex.measure === 'weights';

export const weightCountOf = (ex: Exercise) => (ex.type === 'reps' ? Math.min(6, Math.max(2, ex.weightCount ?? ex.repScheme?.length ?? 2)) : 1);

/** The several weights recorded for an exercise, padded to its weight count. */
export function valuesOf(w: Workout, ex: Exercise): (number | null)[] {
  const v = w.results[ex.id]?.values ?? [];
  return Array.from({ length: weightCountOf(ex) }, (_, i) => v[i] ?? null);
}

export function matchingValues(from: Workout | undefined, ex: Exercise): (number | null)[] | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items).filter((f) => recordsWeights(f.ex));
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name);
  return match ? from.results[match.ex.id]?.values : undefined;
}

export const fmtValues = (values: (number | null)[]) => values.map((v) => (v === null ? '–' : fmtNum(v))).join(' / ');

export const recordsText = (ex: Exercise) => ex.type === 'reps' && ex.measure === 'text';

/** Text recorded for the matching exercise (same id, else same name) in another workout. */
export function matchingText(from: Workout | undefined, ex: Exercise): string | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items).filter((f) => recordsText(f.ex));
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name);
  return match ? from.results[match.ex.id]?.text || undefined : undefined;
}

/** Copies every recorded value from `from`. Returns how many were copied. */
export function copyValues(w: Workout, from: Workout): number {
  let n = 0;
  for (const { ex } of flatten(w.items)) {
    // Activities record what happened that day, so there is nothing to carry over.
    if (recordsWeights(ex)) {
      const v = matchingValues(from, ex);
      if (!v?.some((x) => x !== null)) continue;
      resultOf(w, ex.id).values = v.slice(0, weightCountOf(ex));
      copyDumbbells(w, from, ex);
      n++;
      continue;
    }
    if (recordsText(ex)) {
      const t = matchingText(from, ex);
      if (t === undefined) continue;
      resultOf(w, ex.id).text = t;
      n++;
      continue;
    }
    if (unitOf(ex) === null || ex.type === 'activity') continue;
    const v = matchingValue(from, ex);
    if (v === undefined) continue;
    resultOf(w, ex.id).value = v;
    if (recordsKg(ex)) copyDumbbells(w, from, ex);
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

// ---- Merging a backup into existing data --------------------------------

export interface MergeSummary {
  programmesAdded: number;
  workoutsAdded: number;
  /** Planned workouts here that the backup has as done, so the backup's copy won. */
  workoutsUpdated: number;
  /** Already here (same workout or same programme slot), so left as they are. */
  skipped: number;
}

/**
 * Adds everything from `incoming` that isn't already in `local`, in place. A workout
 * matches by id, or by programme and scheduled slot (the same programme generates
 * the same slots on every device). When both copies exist, the local one is kept,
 * unless only the backup's has been done. Settings stay as they are here.
 */
export function mergeData(local: Data, incoming: Data): MergeSummary {
  const summary: MergeSummary = { programmesAdded: 0, workoutsAdded: 0, workoutsUpdated: 0, skipped: 0 };

  const programmeIds = new Set(local.programmes.map((p) => p.id));
  for (const p of incoming.programmes) {
    if (programmeIds.has(p.id)) continue;
    local.programmes.push(p);
    programmeIds.add(p.id);
    summary.programmesAdded++;
  }

  const byId = new Map(local.workouts.map((w, i) => [w.id, i]));
  const slotKey = (w: Workout) => (w.programmeId && w.scheduledDate ? `${w.programmeId}@${w.scheduledDate}` : undefined);
  const bySlot = new Map<string, number>();
  local.workouts.forEach((w, i) => {
    const k = slotKey(w);
    if (k) bySlot.set(k, i);
  });
  const untouched = (w: Workout) => w.status === 'planned' && !w.startedAt && Object.keys(w.results).length === 0;

  for (const w of incoming.workouts) {
    const k = slotKey(w);
    const i = byId.get(w.id) ?? (k ? bySlot.get(k) : undefined);
    if (i === undefined) {
      local.workouts.push(w);
      byId.set(w.id, local.workouts.length - 1);
      if (k) bySlot.set(k, local.workouts.length - 1);
      summary.workoutsAdded++;
    } else if (w.status === 'done' && untouched(local.workouts[i])) {
      local.workouts[i] = w;
      byId.set(w.id, i);
      summary.workoutsUpdated++;
    } else {
      summary.skipped++;
    }
  }
  return summary;
}

// ---- Search ---------------------------------------------------------------

export interface SearchEntry {
  workout: Workout;
  ex: Exercise;
  sets: number;
  result?: Result;
}

export interface SearchGroup {
  name: string;
  entries: SearchEntry[];
}

// Strip accents so "guma" finds "gumą". Letters like ł and ø aren't accented forms, so map them by hand.
const LETTERS: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[łøđßæœ]/g, (c) => LETTERS[c]).replace(/\s+/g, ' ').trim();

/**
 * Finished exercises whose name contains every word of the query, grouped by
 * exercise name. Groups and entries are newest first.
 */
export function searchExercises(data: Data, query: string): SearchGroup[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const groups = new Map<string, SearchGroup>();
  const done = data.workouts.filter((w) => w.status === 'done').sort((a, b) => b.date.localeCompare(a.date) || (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  for (const workout of done) {
    for (const { ex, sets } of flatten(workout.items)) {
      const key = fold(ex.name);
      if (!words.every((word) => key.includes(word))) continue;
      const group = groups.get(key) ?? { name: ex.name.trim(), entries: [] };
      group.entries.push({ workout, ex, sets, result: workout.results[ex.id] });
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.entries[0].workout.date.localeCompare(a.entries[0].workout.date) || a.name.localeCompare(b.name));
}

/** Every distinct exercise name in finished workouts, for suggestions. */
export function exerciseNames(data: Data): string[] {
  const names = new Map<string, string>();
  for (const w of data.workouts) if (w.status === 'done') for (const { ex } of flatten(w.items)) names.set(fold(ex.name), ex.name.trim());
  return [...names.values()].sort((a, b) => a.localeCompare(b));
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
  const until = end.kind === 'never' ? addDays(today, HORIZON_DAYS) : lastDay(p.schedule);
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
