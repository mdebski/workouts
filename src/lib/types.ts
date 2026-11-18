export type ISODate = string; // YYYY-MM-DD, local calendar date

export type Feel = 'easy' | 'hard' | 'failed';

interface ExerciseBase {
  id: string;
  name: string;
  description?: string;
}

export interface RepsExercise extends ExerciseBase {
  type: 'reps';
  sets: number;
  reps: number;
  /** Varying reps, one entry per set (e.g. 5, 5, 10). When set, `sets` is its length and `reps` its first entry. */
  repScheme?: number[];
  /**
   * What gets recorded per workout: nothing, a weight (kg), several weights (e.g. one
   * per set, or for two movements done together), a hold time (s) or free text.
   */
  measure: 'none' | 'weight' | 'weights' | 'time' | 'text';
  /** How many weights are recorded when `measure` is 'weights'. */
  weightCount?: number;
  restBetweenSets?: number;
}

export interface TimedExercise extends ExerciseBase {
  type: 'timed';
  /** Rounds of work then rest, e.g. 3 × (5 s on, 5 s off). There is no off time after the last one. */
  reps: number;
  workSec: number;
  restSec: number;
  trackWeight: boolean;
}

export interface ActivityExercise extends ExerciseBase {
  type: 'activity';
  /** What gets recorded when it is done: how many, how many minutes, or how far (km). Nothing is preset. */
  measure: 'count' | 'time' | 'distance';
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
}

export type Recorded = number | (number | null)[] | string;

export interface Result {
  setsDone: number;
  /**
   * What was recorded, if anything; which kind depends on the exercise:
   * a number (kg, seconds, minutes, km or a count), several weights (a gap is null),
   * or a note.
   */
  recorded?: Recorded;
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
