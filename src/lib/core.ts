import { addDays, isISODate, maxISO } from './dates.ts';
import { lastDay, occurrences } from './schedule.ts';
import { formatDuration } from './duration.ts';
import { cleanValues, describeRecord, fmtNum, gradeRank, hasRecorded, isGradeKind, isNumberKind, legacyRecord, legacyValues, valuesFor } from './record.ts';
import type { Data, Exercise, ISODate, Item, Programme, RecordKind, RecordValue, Result, Step, Workout } from './types.ts';

export { fmtNum, hasRecorded } from './record.ts';

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
        const legacy = done as (Result & { value?: number; recorded?: unknown }) | undefined;
        if (legacy && legacy.setsDone > 0 && legacy.value === undefined && legacy.recorded === undefined && typeof it.target === 'number') legacy.value = it.target;
        delete it.target;
      }
    }
  };
  for (const p of r.programmes) untarget(p.items);
  for (const w of r.workouts) untarget(w.items, w.results);
  // Exercises used to record one thing, set by type (`measure`, `trackWeight`), into a single
  // `recorded` on the result. They now list what they record (`record`) and results hold one
  // value per entry (`values`). A workout whose exercises all have `record` is already new.
  type Raw = Record<string, unknown>;
  const rawExercises = (items: Item[]): Raw[] =>
    items.flatMap((it) => (it.type === 'superset' ? it.items : [it])).filter((it) => it.type !== 'rest') as unknown as Raw[];
  const isNewFormat = (items: Item[]) => rawExercises(items).every((ex) => Array.isArray(ex.record));
  const legacy = r.workouts.filter((w) => !isNewFormat(w.items));
  // Older still, a result kept a number, several weights and a note in separate fields,
  // at most one of them set; they became the single `recorded`.
  for (const w of legacy) {
    for (const res of Object.values(w.results) as (Result & { recorded?: unknown; value?: number; values?: (number | null)[]; text?: string })[]) {
      if (res.recorded === undefined) {
        const was = res.value ?? res.values ?? (res.text || undefined);
        if (was !== undefined) res.recorded = was;
      }
      delete res.value;
      delete res.values;
      delete res.text;
    }
  }
  for (const w of legacy) {
    const byId = new Map(rawExercises(w.items).map((ex) => [ex.id, ex]));
    for (const [id, res] of Object.entries(w.results) as [string, Result & { recorded?: unknown }][]) {
      const ex = byId.get(id);
      const values = ex ? legacyValues(ex, res.recorded) : undefined;
      if (values) res.values = values;
      delete res.recorded;
    }
  }
  const toRecordList = (items: Item[]) => {
    for (const ex of rawExercises(items)) {
      ex.record = legacyRecord(ex);
      delete ex.measure;
      delete ex.weightCount;
      delete ex.trackWeight;
    }
  };
  for (const p of r.programmes) toRecordList(p.items);
  for (const w of r.workouts) {
    toRecordList(w.items);
    const byId = new Map(flatten(w.items).map((f) => [f.ex.id, f.ex]));
    for (const [id, res] of Object.entries(w.results)) {
      const ex = byId.get(id);
      const values = ex ? cleanValues(ex.record, res.values) : undefined;
      if (values) res.values = values;
      else delete res.values;
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

/** Whether the exercise records a weight in kg, so a dumbbell flag makes sense. */
export const recordsKg = (ex: Exercise) => ex.record.includes('weight');

/** Carries the dumbbell flag over from another workout's result. */
function copyDumbbells(w: Workout, from: Workout, ex: Exercise) {
  const match = matchingExercise(from, ex);
  const r = resultOf(w, ex.id);
  if (match && from.results[match.id]?.dumbbells) r.dumbbells = true;
  else delete r.dumbbells;
}

export function fmtSecs(total: number): string {
  const s = Math.max(0, Math.ceil(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The plan in a few words, e.g. "3 × 10 · weight · rest 90s". Without what gets recorded
 * when `withRecord` is false (shown elsewhere as values).
 */
export function describe(ex: Exercise, inSuperset = false, withRecord = true): string {
  const rest = (n?: number) => (n ? ` · rest ${formatDuration(n)}` : '');
  const what = withRecord && ex.record.length ? ` · ${describeRecord(ex.record)}` : '';
  if (ex.type === 'reps') {
    const holds = ex.record.includes('time') && ex.reps === 1;
    const one = holds ? 'hold' : `${ex.reps} reps`;
    const sets = ex.repScheme?.length ? `${ex.repScheme.join(' / ')} reps` : inSuperset ? one : `${ex.sets} × ${holds ? 'hold' : ex.reps}`;
    return sets + what + (inSuperset ? '' : rest(ex.restBetweenSets));
  }
  if (ex.type === 'timed') return `${ex.reps} × ${formatDuration(ex.workSec)} / ${formatDuration(ex.restSec)}${what}`;
  return `Activity${what}`;
}

export function resultOf(w: Workout, exId: string): Result {
  // Read the entry back after creating it: when `w` is reactive state, the stored
  // value is a proxy, and writes to the plain object we passed in would be lost.
  if (!w.results[exId]) w.results[exId] = { setsDone: 0 };
  return w.results[exId];
}

/** The value recorded for entry `i` of an exercise's record list in this workout. */
export const valueAt = (w: Workout, ex: Exercise, i: number): RecordValue => w.results[ex.id]?.values?.[i] ?? null;

/** Sets entry `i`; a cleared entry is null, and a result with nothing left loses its values. */
export function setValueAt(w: Workout, ex: Exercise, i: number, v: RecordValue) {
  const r = resultOf(w, ex.id);
  const values = valuesFor(ex, r);
  values[i] = v === '' ? null : v;
  if (values.some((x) => x !== null)) r.values = values;
  else delete r.values;
}

/**
 * An exercise is finished when all its sets (or rounds) are done, or when it's marked
 * failed: a missed or abandoned exercise is recorded as failed. An activity is done
 * once an amount is recorded.
 */
export function exerciseFinished(r: Result | undefined, ex: Exercise, sets: number): boolean {
  if (r?.feel === 'failed') return true;
  if (ex.type === 'activity') return activityRecorded(ex, r) || (r?.setsDone ?? 0) >= sets;
  return (r?.setsDone ?? 0) >= sets;
}

/** An activity counts as done once anything is recorded for it (a zero doesn't count). */
const activityRecorded = (ex: Exercise, r: Result | undefined) =>
  valuesFor(ex, r).some((v) => (typeof v === 'number' ? v > 0 : v !== null && v.trim() !== ''));

/** Done means every exercise finished. Workout status is never stored, only worked out from this. */
export function isComplete(w: Workout): boolean {
  const flat = flatten(w.items);
  return flat.length > 0 && flat.every(({ ex, sets }) => exerciseFinished(w.results[ex.id], ex, sets));
}

/**
 * Started: a ticked set, how it felt, or an activity's value. A weight or other value on its
 * own doesn't count, since it can be filled in before starting.
 */
export function hasProgress(w: Workout): boolean {
  return flatten(w.items).some(({ ex }) => {
    const r = w.results[ex.id];
    return !!r && (r.setsDone > 0 || !!r.feel || (ex.type === 'activity' && activityRecorded(ex, r)));
  });
}

/** Anything entered at all, so it is never thrown away when a schedule is rebuilt. */
const hasEntries = (w: Workout) => isLogged(w) || !!w.startedAt || !!w.notes?.trim() || Object.values(w.results).some(hasRecorded);

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

/** The same exercise in another workout: same id, else same name and the same things recorded. */
export function matchingExercise(from: Workout | undefined, ex: Exercise): Exercise | undefined {
  if (!from) return undefined;
  const flat = flatten(from.items).map((f) => f.ex);
  const same = (a: RecordKind[], b: RecordKind[]) => a.length === b.length && a.every((k, i) => k === b[i]);
  return flat.find((o) => o.id === ex.id) ?? flat.find((o) => o.name === ex.name && same(o.record, ex.record)) ?? flat.find((o) => o.name === ex.name);
}

/**
 * Entry `i`'s value in another workout. Entries pair up by kind: the second weight here
 * reads the second weight there, whatever else is listed around it.
 */
export function matchingValueAt(from: Workout | undefined, ex: Exercise, i: number): RecordValue {
  const match = matchingExercise(from, ex);
  if (!from || !match) return null;
  const kind = ex.record[i];
  const nth = ex.record.slice(0, i).filter((k) => k === kind).length;
  const j = match.record.map((k, n) => (k === kind ? n : -1)).filter((n) => n >= 0)[nth];
  return j === undefined ? null : (from.results[match.id]?.values?.[j] ?? null);
}

/** Copies every recorded value from `from`. Returns how many exercises got values. */
export function copyValues(w: Workout, from: Workout): number {
  let n = 0;
  for (const { ex } of flatten(w.items)) {
    // Activities record what happened that day, so there is nothing to carry over.
    if (ex.type === 'activity') continue;
    const values = ex.record.map((_, i) => matchingValueAt(from, ex, i));
    if (!values.some((v) => v !== null)) continue;
    resultOf(w, ex.id).values = values;
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
  const untouched = (w: Workout) => !hasEntries(w);

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
/** Sets and reps alone, e.g. "3 × 5", leaving out what gets recorded (shown elsewhere as values). */
export const describePlan = (ex: Exercise, inSuperset = false) => describe(ex, inSuperset, false);

/** The number to sort a result by: the heaviest weight, else the first number, else the hardest grade. */
export function entryValue({ ex, result: r }: SearchEntry): number | undefined {
  const vs = valuesFor(ex, r);
  const weights = vs.filter((v, i): v is number => ex.record[i] === 'weight' && typeof v === 'number');
  if (weights.length) return Math.max(...weights);
  const i = vs.findIndex((v, n) => typeof v === 'number' && isNumberKind(ex.record[n]));
  if (i >= 0) return vs[i] as number;
  const g = ex.record.findIndex((k, n) => isGradeKind(k) && typeof vs[n] === 'string');
  if (g >= 0) return gradeRank(ex.record[g] as 'route' | 'boulder', vs[g] as string);
  return undefined;
}

export type SearchSort = 'date' | 'value';

export function searchExercises(data: Data, query: string, sort: SearchSort = 'date'): SearchGroup[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const groups = new Map<string, SearchGroup>();
  const done = data.workouts.filter(isLogged).sort((a, b) => b.date.localeCompare(a.date) || (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  for (const workout of done) {
    const workoutName = fold(workout.name);
    for (const { ex, sets } of flatten(workout.items)) {
      const key = fold(ex.name);
      // Words can match the exercise or the workout it was done in ("powisle deadlift").
      const both = `${key} ${workoutName}`;
      if (!words.every((word) => both.includes(word))) continue;
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

/** Every distinct workout name among finished workouts, for suggestions. */
export function workoutNames(data: Data): string[] {
  const names = new Map<string, string>();
  for (const w of data.workouts) if (isLogged(w) && w.name.trim()) names.set(fold(w.name), w.name.trim());
  return [...names.values()].sort((a, b) => a.localeCompare(b));
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
 * Rebuilds a programme's workouts after it is created or edited: every slot from the start
 * date is laid out again by the current schedule, so past slots show up as missed.
 * Done, partly done and started workouts (and any with a note) are kept and use up their slot.
 * Archiving only stops future planning: past slots stay as they are.
 */
export function syncProgramme(data: Data, p: Programme, today: ISODate): void {
  const worked = hasEntries;
  const keep = p.archived ? (w: Workout) => worked(w) || (w.scheduledDate ?? w.date) < today : worked;
  const kept = data.workouts.filter((w) => w.programmeId === p.id && keep(w));
  data.workouts = data.workouts.filter((w) => w.programmeId !== p.id || keep(w));
  if (p.archived) return;

  const taken = new Set(kept.map((w) => w.scheduledDate));
  const { end } = p.schedule;
  let remaining = end.kind === 'count' ? end.n - kept.length : Infinity;
  const until = end.kind === 'never' ? addDays(today, HORIZON_DAYS) : lastDay(p.schedule);

  for (const date of occurrences(p.schedule)) {
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
  data.workouts = data.workouts.filter((w) => w.programmeId !== id || hasEntries(w));
  data.programmes = data.programmes.filter((p) => p.id !== id);
}

/**
 * One programme with its workouts up to today, as a backup file that the usual import
 * takes: merging it adds the programme and plans its future workouts again.
 */
export function programmeBackup(data: Data, id: string, today: ISODate): Data {
  return {
    version: 1,
    programmes: data.programmes.filter((p) => p.id === id),
    workouts: data.workouts.filter((w) => w.programmeId === id && (w.date < today || isLogged(w))),
    settings: data.settings,
  };
}

/** Deletes a programme and every workout it made, finished ones included. */
export function deleteProgrammeAndWorkouts(data: Data, id: string): void {
  data.workouts = data.workouts.filter((w) => w.programmeId !== id);
  data.programmes = data.programmes.filter((p) => p.id !== id);
}
