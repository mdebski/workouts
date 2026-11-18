import { addDays, isISODate, maxISO } from './dates.ts';
import { lastDay, occurrences } from './schedule.ts';
import { formatDuration } from './duration.ts';
import type { Data, Exercise, ISODate, Item, Programme, Recorded, Result, Step, Workout } from './types.ts';

// ---- Reading what was recorded --------------------------------------------

export const numberOf = (r: Result | undefined): number | undefined => (typeof r?.recorded === 'number' ? r.recorded : undefined);
export const numbersOf = (r: Result | undefined): (number | null)[] | undefined => (Array.isArray(r?.recorded) ? r.recorded : undefined);
export const textOf = (r: Result | undefined): string | undefined => (typeof r?.recorded === 'string' && r.recorded.trim() ? r.recorded : undefined);
/** Whether anything was recorded: a number, at least one weight, or a non-empty note. */
export const hasRecorded = (r: Result | undefined) => numberOf(r) !== undefined || !!numbersOf(r)?.some((v) => v !== null) || textOf(r) !== undefined;

/** How far ahead open-ended programmes are generated. */
export const HORIZON_DAYS = 56;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const emptyData = (): Data => ({
  version: 1,
  programmes: [],
  workouts: [],
  settings: { weightSteps: [1.25, 2.5, 5], emoji: ['🏋️', '🏃', '🧘'] },
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
  // Timed exercises are just rounds of work and rest. Older ones had sets of rounds
  // (and before that, `sets` meant rounds): fold every set into the round count, and
  // turn done sets into done rounds, except in supersets, where done counts superset rounds.
  type OldTimed = { type: 'timed'; id: string; sets?: number; reps?: number; restBetweenSets?: number };
  const upgrade = (items: Item[], results?: Data['workouts'][number]['results'], inSuperset = false) => {
    for (const it of items) {
      if (it.type === 'superset') upgrade(it.items, results, true);
      else if (it.type === 'timed') {
        const t = it as unknown as OldTimed;
        if (typeof t.sets !== 'number') continue;
        const perSet = typeof t.reps === 'number' ? t.reps : 1;
        t.reps = Math.max(1, t.sets * perSet);
        const r = results?.[t.id];
        if (r && !inSuperset) r.setsDone = Math.min(t.reps, r.setsDone * perSet);
        delete t.sets;
        delete t.restBetweenSets;
      }
    }
  };
  for (const p of r.programmes) upgrade(p.items);
  for (const w of r.workouts) upgrade(w.items, w.results);
  // Rests used to be settings on exercises ("rest after") and supersets ("between rounds",
  // "after"). They are now items of their own, placed where they happen. Ids are derived,
  // so the same programme converts the same way on every device.
  type OldRests = { restAfter?: number; restBetweenRounds?: number };
  const restsToItems = (items: Item[]): Item[] =>
    items.flatMap((it): Item[] => {
      const old = it as Item & OldRests;
      const after: Item[] = old.restAfter ? [{ id: `${it.id}-rest`, type: 'rest', seconds: old.restAfter }] : [];
      delete old.restAfter;
      if (it.type === 'superset') {
        for (const step of it.items) delete (step as Step & OldRests).restAfter;
        if (old.restBetweenRounds) it.items.push({ id: `${it.id}-round-rest`, type: 'rest', seconds: old.restBetweenRounds });
        delete old.restBetweenRounds;
      }
      return [it, ...after];
    });
  for (const p of r.programmes) p.items = restsToItems(p.items);
  for (const w of r.workouts) w.items = restsToItems(w.items);
  // Activities used to carry a preset amount. It is now only ever recorded, so keep
  // it as the recorded value where the activity was done, then drop it.
  const untarget = (items: Item[], results?: Data['workouts'][number]['results']) => {
    for (const it of items) {
      if (it.type === 'superset') untarget(it.items, results);
      else if (it.type === 'activity' && 'target' in it) {
        const done = results?.[it.id];
        const legacy = done as (Result & { value?: number }) | undefined;
        if (legacy && legacy.setsDone > 0 && legacy.value === undefined && legacy.recorded === undefined && typeof it.target === 'number') legacy.value = it.target;
        delete it.target;
      }
    }
  };
  for (const p of r.programmes) untarget(p.items);
  for (const w of r.workouts) untarget(w.items, w.results);
  // A result used to keep a number, several weights and a note in separate fields,
  // at most one of them set. They're now a single `recorded`.
  for (const w of r.workouts) {
    for (const res of Object.values(w.results) as (Result & { value?: number; values?: (number | null)[]; text?: string })[]) {
      if (res.recorded === undefined) {
        const was: Recorded | undefined = res.value ?? res.values ?? (res.text || undefined);
        if (was !== undefined) res.recorded = was;
      }
      delete res.value;
      delete res.values;
      delete res.text;
    }
  }
  // Workout status used to be stored. It's now worked out from the results, so a workout
  // stored as done keeps reading as done: anything it left unfinished counts as failed.
  for (const w of r.workouts as (Workout & { status?: string })[]) {
    if (w.status === 'done') {
      for (const { ex, sets } of flatten(w.items)) {
        const res = (w.results[ex.id] ??= { setsDone: 0 });
        if (!exerciseFinished(res, ex, sets)) res.feel = 'failed';
      }
      w.completedAt ??= `${w.date}T12:00:00.000Z`;
    }
    delete w.status;
  }
  const steps = r.settings?.weightSteps;
  const weightSteps = Array.isArray(steps) && steps.every((n) => typeof n === 'number' && n > 0) && steps.length ? steps : emptyData().settings.weightSteps;
  const icons = r.settings?.emoji;
  const emoji = Array.isArray(icons) && icons.every((e) => typeof e === 'string' && e.trim()) ? [...new Set(icons.map((e) => e.trim()))].slice(0, 40) : emptyData().settings.emoji;
  return { version: 1, programmes: r.programmes, workouts: r.workouts, settings: { weightSteps, emoji } };
}

// ---- Exercises -------------------------------------------------------------

export interface FlatExercise {
  ex: Exercise;
  /** Number of ticks: sets, or the superset's rounds. */
  sets: number;
  supersetId?: string;
}

export const isExercise = (it: Item): it is Exercise => it.type !== 'superset' && it.type !== 'rest';

/** Every exercise, in order, with how many sets (or rounds) it has. Rests aren't exercises and are left out. */
export function flatten(items: Item[]): FlatExercise[] {
  return items.flatMap((it): FlatExercise[] =>
    it.type === 'rest'
      ? []
      : it.type === 'superset'
        ? it.items.filter(isExercise).map((ex) => ({ ex, sets: it.rounds, supersetId: it.id }))
        : [{ ex: it, sets: it.type === 'activity' ? 1 : it.type === 'timed' ? it.reps : it.sets }],
  );
}

export type Unit = 'kg' | 's' | 'min' | 'km' | '×';

/** The unit of the value recorded for an exercise, or null if nothing is recorded. */
export function unitOf(ex: Exercise): Unit | null {
  if (ex.type === 'reps') return ex.measure === 'weight' || ex.measure === 'weights' ? 'kg' : ex.measure === 'time' ? 's' : null;
  if (ex.type === 'timed') return ex.trackWeight ? 'kg' : null;
  return ex.measure === 'time' ? 'min' : ex.measure === 'distance' ? 'km' : '×';
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

/** How an activity's amount is shown and nudged: its unit word and the − / + step. */
export function activityAmount(ex: Exercise): { unit: string; step: number; stepLabel: string } {
  if (ex.type !== 'activity' || ex.measure === 'count') return { unit: 'times', step: 1, stepLabel: 'one' };
  if (ex.measure === 'distance') return { unit: 'km', step: 0.5, stepLabel: '0.5 km' };
  return { unit: 'min', step: 1, stepLabel: 'one minute' };
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
  const rest = (n?: number) => (n ? ` · rest ${formatDuration(n)}` : '');
  if (ex.type === 'reps') {
    const what = ex.measure === 'time' ? (ex.reps === 1 ? 'hold' : `${ex.reps} holds`) : `${ex.reps} reps`;
    const sets = ex.repScheme?.length ? `${ex.repScheme.join(' / ')} reps` : inSuperset ? what : `${ex.sets} × ${ex.measure === 'time' && ex.reps === 1 ? 'hold' : ex.reps}`;
    const m = ex.measure === 'none' ? '' : ex.measure === 'text' ? ' · notes' : ex.measure === 'weights' ? ` · ${weightCountOf(ex)} weights` : ` · ${ex.measure}`;
    return sets + m + (inSuperset ? '' : rest(ex.restBetweenSets));
  }
  if (ex.type === 'timed') {
    return `${ex.reps} × ${formatDuration(ex.workSec)} / ${formatDuration(ex.restSec)}${ex.trackWeight ? ' · weight' : ''}`;
  }
  return ex.measure === 'time' ? 'Activity · record minutes' : ex.measure === 'distance' ? 'Activity · record distance' : 'Activity · record a count';
}

export function resultOf(w: Workout, exId: string): Result {
  // Read the entry back after creating it: when `w` is reactive state, the stored
  // value is a proxy, and writes to the plain object we passed in would be lost.
  if (!w.results[exId]) w.results[exId] = { setsDone: 0 };
  return w.results[exId];
}

/** The value recorded for an exercise in this workout, if any. */
export function valueOf(w: Workout, ex: Exercise): number | undefined {
  return numberOf(w.results[ex.id]);
}

/**
 * An exercise is finished when all its sets (or rounds) are done, or when it's marked
 * failed: a missed or abandoned exercise is recorded as failed. An activity is done
 * once an amount is recorded.
 */
export function exerciseFinished(r: Result | undefined, ex: Exercise, sets: number): boolean {
  if (r?.feel === 'failed') return true;
  if (ex.type === 'activity') return (numberOf(r) ?? 0) > 0 || (r?.setsDone ?? 0) >= sets;
  return (r?.setsDone ?? 0) >= sets;
}

/** Done means every exercise finished. Workout status is never stored, only worked out from this. */
export function isComplete(w: Workout): boolean {
  const flat = flatten(w.items);
  return flat.length > 0 && flat.every(({ ex, sets }) => exerciseFinished(w.results[ex.id], ex, sets));
}

/** Anything at all recorded: a ticked set, a value, a note or how it felt. */
export function hasProgress(w: Workout): boolean {
  return Object.values(w.results).some((r) => r.setsDone > 0 || hasRecorded(r) || !!r.feel);
}

/** Done, or at least started: the workouts that count as history. */
export const isLogged = (w: Workout) => isComplete(w) || hasProgress(w);

// ---- Workouts --------------------------------------------------------------

export type Status = 'done' | 'partial' | 'missed' | 'today' | 'planned';

/** Worked out from the results and the date; see isComplete. */
export function statusOf(w: Workout, today: ISODate): Status {
  if (isComplete(w)) return 'done';
  if (w.date < today) return hasProgress(w) ? 'partial' : 'missed';
  return w.date === today ? 'today' : 'planned';
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
  return all.slice(0, i).reverse().find(isLogged)
    ?? all.filter((o) => o.id !== w.id && isLogged(o) && o.date <= w.date).at(-1);
}

/** Value recorded for the matching exercise (same id, else same name) in another workout. */
export function matchingValue(from: Workout | undefined, ex: Exercise): number | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items);
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name && unitOf(f.ex) === unitOf(ex));
  return match ? numberOf(from.results[match.ex.id]) : undefined;
}

export const recordsWeights = (ex: Exercise): ex is Extract<Exercise, { type: 'reps' }> => ex.type === 'reps' && ex.measure === 'weights';

export const weightCountOf = (ex: Exercise) => (ex.type === 'reps' ? Math.min(6, Math.max(2, ex.weightCount ?? ex.repScheme?.length ?? 2)) : 1);

/** The several weights recorded for an exercise, padded to its weight count. */
export function valuesOf(w: Workout, ex: Exercise): (number | null)[] {
  const v = numbersOf(w.results[ex.id]) ?? [];
  return Array.from({ length: weightCountOf(ex) }, (_, i) => v[i] ?? null);
}

export function matchingValues(from: Workout | undefined, ex: Exercise): (number | null)[] | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items).filter((f) => recordsWeights(f.ex));
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name);
  return match ? numbersOf(from.results[match.ex.id]) : undefined;
}

export const fmtValues = (values: (number | null)[]) => values.map((v) => (v === null ? '–' : fmtNum(v))).join(' / ');

export const recordsText = (ex: Exercise) => ex.type === 'reps' && ex.measure === 'text';

/** Text recorded for the matching exercise (same id, else same name) in another workout. */
export function matchingText(from: Workout | undefined, ex: Exercise): string | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items).filter((f) => recordsText(f.ex));
  const match = flat.find((f) => f.ex.id === ex.id) ?? flat.find((f) => f.ex.name === ex.name);
  return match ? textOf(from.results[match.ex.id]) : undefined;
}

/** Copies every recorded value from `from`. Returns how many were copied. */
export function copyValues(w: Workout, from: Workout): number {
  let n = 0;
  for (const { ex } of flatten(w.items)) {
    // Activities record what happened that day, so there is nothing to carry over.
    if (recordsWeights(ex)) {
      const v = matchingValues(from, ex);
      if (!v?.some((x) => x !== null)) continue;
      resultOf(w, ex.id).recorded = v.slice(0, weightCountOf(ex));
      copyDumbbells(w, from, ex);
      n++;
      continue;
    }
    if (recordsText(ex)) {
      const t = matchingText(from, ex);
      if (t === undefined) continue;
      resultOf(w, ex.id).recorded = t;
      n++;
      continue;
    }
    if (unitOf(ex) === null || ex.type === 'activity') continue;
    const v = matchingValue(from, ex);
    if (v === undefined) continue;
    resultOf(w, ex.id).recorded = v;
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
  const untouched = (w: Workout) => !isLogged(w) && !w.startedAt;

  for (const w of incoming.workouts) {
    const k = slotKey(w);
    const i = byId.get(w.id) ?? (k ? bySlot.get(k) : undefined);
    if (i === undefined) {
      local.workouts.push(w);
      byId.set(w.id, local.workouts.length - 1);
      if (k) bySlot.set(k, local.workouts.length - 1);
      summary.workoutsAdded++;
    } else if (isLogged(w) && untouched(local.workouts[i])) {
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
/** Sets and reps alone, e.g. "3 × 5", leaving out what gets recorded (shown elsewhere as a unit or value). */
export const describePlan = (ex: Exercise, inSuperset = false) =>
  describe(ex, inSuperset).replace(/ · (weight|time|notes|\d+ weights)(?= · |$)/, '');

/**
 * What was recorded for an exercise, in a few words: "42.5 kg", "10 / 12.5 kg",
 * "1min 10s", "5.4 km", "30 times", or a note. Empty when nothing was recorded.
 */
export function fmtRecorded(ex: Exercise, r: Result | undefined): string {
  if (!r) return '';
  if (ex.type === 'activity') {
    const n = numberOf(r);
    if (n === undefined) return '';
    return ex.measure === 'time' ? formatDuration(n * 60) : `${fmtNum(n)} ${activityAmount(ex).unit}`;
  }
  if (recordsText(ex)) return textOf(r) ?? '';
  if (recordsWeights(ex)) { const vs = numbersOf(r); return vs?.some((v) => v !== null) ? `${fmtValues(vs)} kg` : ''; }
  const unit = unitOf(ex);
  const n = numberOf(r);
  if (!unit || n === undefined) return '';
  return unit === 's' ? formatDuration(n) : `${fmtNum(n)} ${unit}`;
}

/** The number to sort a result by: its weight, time, count or distance; the heaviest of several weights. */
export function entryValue({ result: r }: SearchEntry): number | undefined {
  const n = numberOf(r);
  if (n !== undefined) return n;
  const values = numbersOf(r)?.filter((v): v is number => v !== null) ?? [];
  return values.length ? Math.max(...values) : undefined;
}

export type SearchSort = 'date' | 'value';

export function searchExercises(data: Data, query: string, sort: SearchSort = 'date'): SearchGroup[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const groups = new Map<string, SearchGroup>();
  const done = data.workouts.filter(isLogged).sort((a, b) => b.date.localeCompare(a.date) || (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  for (const workout of done) {
    for (const { ex, sets } of flatten(workout.items)) {
      const key = fold(ex.name);
      if (!words.every((word) => key.includes(word))) continue;
      const group = groups.get(key) ?? { name: ex.name.trim(), entries: [] };
      group.entries.push({ workout, ex, sets, result: workout.results[ex.id] });
      groups.set(key, group);
    }
  }
  // Groups stay in date order (the most recently done exercise first) either way.
  const list = [...groups.values()].sort((a, b) => b.entries[0].workout.date.localeCompare(a.entries[0].workout.date) || a.name.localeCompare(b.name));
  if (sort === 'value') {
    // Highest first; entries with nothing recorded go last. Ties keep date order (stable sort).
    for (const g of list) g.entries.sort((a, b) => (entryValue(b) ?? -Infinity) - (entryValue(a) ?? -Infinity));
  }
  return list;
}

/** Every distinct exercise name in finished workouts, for suggestions. */
export function exerciseNames(data: Data): string[] {
  const names = new Map<string, string>();
  for (const w of data.workouts) if (isLogged(w)) for (const { ex } of flatten(w.items)) names.set(fold(ex.name), ex.name.trim());
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// ---- Programmes ------------------------------------------------------------

function fromProgramme(p: Programme, date: ISODate): Workout {
  return { id: uid(), programmeId: p.id, name: p.name, emoji: p.emoji, scheduledDate: date, date, items: clone(p.items), results: {} };
}

/**
 * Rebuilds a programme's planned workouts after it is created or edited.
 * Done, started and past (missed) workouts are kept and still use up their slot.
 */
export function syncProgramme(data: Data, p: Programme, today: ISODate, isNew = false): void {
  const keep = (w: Workout) => isLogged(w) || !!w.startedAt || (w.scheduledDate ?? w.date) < today;
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
  data.workouts = data.workouts.filter((w) => w.programmeId !== id || isLogged(w) || !!w.startedAt);
  data.programmes = data.programmes.filter((p) => p.id !== id);
}

/** Deletes a programme and every workout it made, finished ones included. */
export function deleteProgrammeAndWorkouts(data: Data, id: string): void {
  data.workouts = data.workouts.filter((w) => w.programmeId !== id);
  data.programmes = data.programmes.filter((p) => p.id !== id);
}
