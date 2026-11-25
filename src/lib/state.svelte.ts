import { emptyData, mergeData, migrate, type MergeSummary, syncProgramme, topUp, deleteProgramme, deleteProgrammeAndWorkouts, uid, clone } from './core.ts';
import { today } from './dates.ts';
import type { Data, Item, Programme, Workout } from './types.ts';

const KEY = 'workouts:v1';

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    // Keep the unreadable copy so nothing is lost, then start clean.
    console.error('Could not read saved data', e);
    const raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(`${KEY}:corrupt:${Date.now()}`, raw);
  }
  return emptyData();
}

export const db: Data = $state(load());
export const ui = $state({ saveError: '' });

topUp(db, today());

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(db);
    try {
      localStorage.setItem(KEY, json);
      ui.saveError = '';
    } catch {
      ui.saveError = 'Could not save. Storage may be full. Export a backup from settings.';
    }
  });
});

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

export const getWorkout = (id: string) => db.workouts.find((w) => w.id === id);
export const getProgramme = (id: string) => db.programmes.find((p) => p.id === id);

export function saveProgramme(p: Programme): void {
  const i = db.programmes.findIndex((o) => o.id === p.id);
  const isNew = i < 0;
  if (isNew) db.programmes.push(p);
  else db.programmes[i] = p;
  syncProgramme(db, isNew ? db.programmes.at(-1)! : db.programmes[i], today());
}

export function removeProgramme(id: string): void {
  deleteProgramme(db, id, today());
}

export function removeProgrammeAndWorkouts(id: string): void {
  deleteProgrammeAndWorkouts(db, id);
}

export function saveWorkout(w: Workout): void {
  const i = db.workouts.findIndex((o) => o.id === w.id);
  if (i < 0) db.workouts.push(w);
  else db.workouts[i] = w;
}

export function removeWorkout(id: string): void {
  db.workouts = db.workouts.filter((w) => w.id !== id);
}

export function mergeIn(data: Data): MergeSummary {
  const local = snapshot();
  const before = new Set(local.programmes.map((p) => p.id));
  const summary = mergeData(local, data);
  db.programmes = local.programmes;
  db.workouts = local.workouts;
  // A programme that is new here gets its schedule laid out, so its future workouts appear too.
  for (const p of db.programmes) if (!before.has(p.id)) syncProgramme(db, p, today());
  topUp(db, today());
  return summary;
}

/** Adds an icon to the quick choices if it isn't there yet (it was picked from the keyboard). */
export function rememberEmoji(emoji: string): void {
  const e = emoji.trim();
  if (e && !db.settings.emoji.includes(e)) db.settings.emoji.push(e);
}

export function replaceAll(data: Data): void {
  db.programmes = data.programmes;
  db.workouts = data.workouts;
  db.settings = data.settings;
  topUp(db, today());
}

export const snapshot = (): Data => clone($state.snapshot(db) as Data);

export function blankProgramme(): Programme {
  return {
    id: uid(),
    name: '',
    emoji: '🏋️',
    items: [],
    schedule: { start: today(), repeat: { kind: 'weekdays', days: [1, 3, 5] }, end: { kind: 'count', n: 12 } },
    archived: false,
  };
}

export function blankWorkout(date: string): Workout {
  return { id: uid(), name: '', emoji: '🏃', date, items: [] as Item[], results: {} };
}

/** A new one-off workout like `w`: same name, icon and exercises, and the weights, times or notes
 *  it recorded; no date, nothing ticked off. */
export function copyOfWorkout(w: Workout): Workout {
  const results: Workout['results'] = {};
  for (const [id, r] of Object.entries(clone(w.results))) {
    if (!r.values) continue;
    results[id] = { setsDone: 0, values: r.values, ...(r.dumbbells ? { dumbbells: true } : {}) };
  }
  return { id: uid(), name: w.name, emoji: w.emoji, date: '', items: clone(w.items), results };
}
