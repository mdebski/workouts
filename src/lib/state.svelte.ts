import { emptyData, migrate, syncProgramme, topUp, deleteProgramme, uid, clone } from './core.ts';
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
  syncProgramme(db, isNew ? db.programmes.at(-1)! : db.programmes[i], today(), isNew);
}

export function removeProgramme(id: string): void {
  deleteProgramme(db, id, today());
}

export function saveWorkout(w: Workout): void {
  const i = db.workouts.findIndex((o) => o.id === w.id);
  if (i < 0) db.workouts.push(w);
  else db.workouts[i] = w;
}

export function removeWorkout(id: string): void {
  db.workouts = db.workouts.filter((w) => w.id !== id);
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
    emoji: '💪',
    items: [],
    schedule: { start: today(), repeat: { kind: 'weekdays', days: [1, 3, 5] }, end: { kind: 'count', n: 12 } },
    archived: false,
  };
}

export function blankWorkout(date: string): Workout {
  return { id: uid(), name: '', emoji: '🏃', date, status: 'planned', items: [] as Item[], results: {} };
}
