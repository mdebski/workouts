export type ISODate = string; // YYYY-MM-DD, local calendar date

export type Feel = 'easy' | 'hard' | 'failed';

/**
 * Something recorded each time an exercise is done. Times are in seconds, distances
 * in km; grades are text: French for routes (e.g. 7a+), the V scale for boulders (e.g. V5).
 */
export type RecordKind = 'weight' | 'time' | 'count' | 'distance' | 'route' | 'boulder' | 'note';

interface ExerciseBase {
  id: string;
  name: string;
  description?: string;
  /** What gets recorded, in order. A kind can repeat, e.g. two weights for two movements. */
  record: RecordKind[];
  /**
   * In a programme with a progression: what changes at each step, in order (e.g. reps
   * 6, 8, 10). Past the last step, the last one holds. Workouts get the step applied and
   * don't keep this list.
   */
  steps?: ExerciseStep[];
}

/** One step of an exercise's progression: the fields that differ from the exercise. Only reps for now. */
export interface ExerciseStep {
  reps?: number;
}

/** When a programme moves on to its next step: every N calendar weeks from the start, or every N workouts done. */
export interface Progression {
  every: number;
  unit: 'weeks' | 'workouts';
}

export interface RepsExercise extends ExerciseBase {
  type: 'reps';
  sets: number;
  reps: number;
  /** Varying reps, one entry per set (e.g. 5, 5, 10). When set, `sets` is its length and `reps` its first entry. */
  repScheme?: number[];
  restBetweenSets?: number;
}

export interface TimedExercise extends ExerciseBase {
  type: 'timed';
  /** Rounds of work then rest, e.g. 3 × (5 s on, 5 s off). There is no off time after the last one. */
  reps: number;
  workSec: number;
  restSec: number;
}

/** Anything else, e.g. a run or a climbing session: done once something is recorded. */
export interface ActivityExercise extends ExerciseBase {
  type: 'activity';
}

export type Exercise = RepsExercise | TimedExercise | ActivityExercise;

/** A rest of its own, between exercises or as a step of a superset round; it has a timer. */
export interface Rest {
  id: string;
  type: 'rest';
  seconds: number;
}

/** What a superset round is made of: exercises, and rests between them. */
export type Step = Exercise | Rest;

export interface Superset {
  id: string;
  type: 'superset';
  rounds: number;
  items: Step[];
}

export type Item = Exercise | Superset | Rest;

export type Repeat =
  | { kind: 'interval'; days: number }
  /** 1 = Monday … 7 = Sunday */
  | { kind: 'weekdays'; days: number[] };

export type End = { kind: 'count'; n: number } | { kind: 'weeks'; n: number } | { kind: 'until'; date: ISODate } | { kind: 'never' };

export interface Schedule {
  start: ISODate;
  repeat: Repeat;
  end: End;
}

export interface Programme {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  items: Item[];
  schedule: Schedule;
  archived: boolean;
  /** Set when the exercises change step by step (see `steps` on exercises). */
  progression?: Progression;
}

/** One recorded value: a number (kg, seconds, a count or km), a grade or a note; null when not set. */
export type RecordValue = number | string | null;

export interface Result {
  setsDone: number;
  /** What was recorded, one value per entry of the exercise's `record`, in the same order. */
  values?: RecordValue[];
  /** The weight was done with dumbbells instead of the usual implement: value(s) are per dumbbell. */
  dumbbells?: boolean;
  feel?: Feel;
}

export interface Workout {
  id: string;
  programmeId?: string;
  name: string;
  emoji: string;
  /** The slot the programme generated; unchanged if the workout is moved or done late. */
  scheduledDate?: ISODate;
  /** The day it is planned for, or was actually done. */
  date: ISODate;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  /** The programme's progression step this workout was planned at (0 = the first). */
  step?: number;
  /** Snapshot of the programme's items, so later edits never change history. */
  items: Item[];
  results: Record<string, Result>;
}

export interface Settings {
  weightSteps: number[];
  /** Quick icon choices in the forms. Icons you pick that aren't here get added. */
  emoji: string[];
}

export interface Data {
  version: 1;
  programmes: Programme[];
  workouts: Workout[];
  settings: Settings;
}
