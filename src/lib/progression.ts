// Programmes that change from step to step, e.g. 3 × 6 in week 1, 3 × 8 in week 2.
//
// The programme says when to move on to the next step (every N weeks, or every N workouts
// done); each exercise lists what it looks like at each step. Past the last step an
// exercise stays as it was at the last one. Each workout gets its own copy of the
// exercises with its step applied, so the rest of the app needs to know nothing about it.

import { diffDays } from './dates.ts';
import { lastDay, occurrences } from './schedule.ts';
import type { Exercise, ExerciseStep, ISODate, Item, Programme, Progression, Schedule, Step } from './types.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The step a calendar date falls in: whole periods of `every` weeks since the start. */
export function weekStep(p: Programme, date: ISODate): number {
  const every = p.progression?.unit === 'weeks' ? p.progression.every : 1;
  return Math.max(0, Math.floor(diffDays(p.schedule.start, date) / (7 * every)));
}

/** An exercise as it is at a step, without its step list (workouts don't need it). */
export function exerciseAt(ex: Exercise, step: number | undefined): Exercise {
  const { steps, ...rest } = copy(ex) as Exercise & { steps?: ExerciseStep[] };
  const out = rest as Exercise;
  if (step === undefined || !steps?.length || out.type !== 'reps') return out;
  const s = steps[Math.min(step, steps.length - 1)];
  if (typeof s?.reps === 'number' && s.reps > 0) {
    if (out.repScheme?.length) {
      // Varying reps (e.g. 6 / 6 / 5): every set moves by the same amount as the first.
      const delta = s.reps - out.reps;
      out.repScheme = out.repScheme.map((r) => Math.max(1, r + delta));
      out.reps = out.repScheme[0];
    } else {
      out.reps = s.reps;
    }
  }
  return out;
}

/** The programme's items as they are at a step (or with no steps at all when `step` is undefined). */
export function itemsAt(items: Item[], step: number | undefined): Item[] {
  const at = <T extends Item | Step>(it: T): T => (it.type === 'rest' ? copy(it) : (exerciseAt(it as Exercise, step) as T));
  return items.map((it) => (it.type === 'superset' ? { ...copy(it), items: it.items.map(at) } : at(it)));
}

/** How many steps the programme has: the longest list of any exercise. */
export function stepCount(items: Item[]): number {
  let n = 0;
  for (const it of items) for (const s of it.type === 'superset' ? it.items : [it]) if (s.type !== 'rest') n = Math.max(n, s.steps?.length ?? 0);
  return n;
}

/** "Week 3" for weekly steps, otherwise "Step 3". */
export function stepLabel(progression: Progression | undefined, step: number): string {
  if (progression?.unit === 'weeks' && progression.every === 1) return `Week ${step + 1}`;
  return `Step ${step + 1}`;
}

/** "every week", "every 2 weeks", "every 3 workouts done". */
export function describeProgression(pr: Progression): string {
  const unit = pr.unit === 'weeks' ? 'week' : 'workout';
  return `${pr.every === 1 ? `every ${unit}` : `every ${pr.every} ${unit}s`}${pr.unit === 'workouts' ? ' done' : ''}`;
}

/** "6, 8, 10" or "6 8 10" as numbers; anything else is ignored. */
export const parseSteps = (text: string) => (text.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000).slice(0, 52);

/**
 * Reps for every step: on an exercise, steps hold reps per step and `reps` mirrors the first,
 * so the exercise still reads right with progression off.
 */
export function setRepSteps(ex: Exercise, reps: number[]): void {
  if (ex.type !== 'reps') return;
  if (!reps.length) {
    delete ex.steps;
    return;
  }
  ex.steps = reps.map((r) => ({ reps: r }));
  if (ex.repScheme?.length) {
    const delta = reps[0] - ex.reps;
    ex.repScheme = ex.repScheme.map((r) => Math.max(1, r + delta));
    ex.reps = ex.repScheme[0];
  } else {
    ex.reps = reps[0];
  }
}

/** The reps an exercise does at each step, e.g. [6, 8, 10]; empty without steps. */
export const repSteps = (ex: Exercise): number[] => (ex.type === 'reps' ? (ex.steps ?? []).map((s) => s.reps ?? ex.reps) : []);

/** Holds (one rep with a recorded time) don't progress by reps. */
export const progressesByReps = (ex: Exercise) => ex.type === 'reps' && !(ex.reps === 1 && ex.record.includes('time'));

/** Steps used for a programme with no end: past them the reps stay put. */
export const OPEN_ENDED_STEPS = 12;
const MAX_STEPS = 52;

/**
 * How many steps the programme runs through, from its schedule: the week its last workout
 * falls in, or its workouts divided up. Undefined when it never ends.
 */
export function programmeSteps(schedule: Schedule, pr: Progression): number | undefined {
  const every = Math.max(1, Math.round(pr.every) || 1);
  const last = lastDay(schedule);
  const count = schedule.end.kind === 'count' ? Math.max(1, schedule.end.n) : undefined;
  if (last === undefined && count === undefined) return undefined;
  const dates: ISODate[] = [];
  for (const d of occurrences(schedule)) {
    if ((last && d > last) || (count && dates.length >= count) || dates.length >= 2000) break;
    dates.push(d);
  }
  if (!dates.length) return 1;
  const n = pr.unit === 'weeks'
    ? weekStep({ schedule, progression: { unit: 'weeks', every } } as Programme, dates[dates.length - 1]) + 1
    : Math.ceil(dates.length / every);
  return Math.min(MAX_STEPS, Math.max(1, n));
}

/** Reps going up (or down) by the same amount each step from where they start, e.g. 6, 8, 10. */
export const evenSteps = (start: number, add: number, steps: number): number[] =>
  Array.from({ length: Math.max(1, steps) }, (_, i) => Math.min(999, Math.max(1, start + i * add)));
