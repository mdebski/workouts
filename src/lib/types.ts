export type ISODate = string; // YYYY-MM-DD, local calendar date

export type Feel = 'easy' | 'hard' | 'failed';

interface ExerciseBase {
  id: string;
  name: string;
  description?: string;
  /** Rest in seconds after the whole exercise. */
  restAfter?: number;
}

export interface RepsExercise extends ExerciseBase {
  type: 'reps';
  sets: number;
  reps: number;
  /** What gets recorded per workout: nothing, a weight (kg) or a hold time (s). */
  measure: 'none' | 'weight' | 'time';
  restBetweenSets?: number;
}

export interface TimedExercise extends ExerciseBase {
  type: 'timed';
  sets: number;
  workSec: number;
  restSec: number;
  trackWeight: boolean;
}

export interface ActivityExercise extends ExerciseBase {
  type: 'activity';
  /** Count of repetitions, or minutes. */
  measure: 'count' | 'time';
  target: number;
}

export type Exercise = RepsExercise | TimedExercise | ActivityExercise;

export interface Superset {
  id: string;
  type: 'superset';
  rounds: number;
  items: Exercise[];
  restBetweenRounds?: number;
  restAfter?: number;
}

export type Item = Exercise | Superset;

export type Repeat =
  | { kind: 'interval'; days: number }
  /** 1 = Monday … 7 = Sunday */
  | { kind: 'weekdays'; days: number[] };

export type End = { kind: 'count'; n: number } | { kind: 'until'; date: ISODate } | { kind: 'never' };

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

export interface Result {
  setsDone: number;
  /** kg, seconds, count or minutes depending on the exercise. */
  value?: number;
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
  status: 'planned' | 'done';
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  /** Snapshot of the programme's items, so later edits never change history. */
  items: Item[];
  results: Record<string, Result>;
}

export interface Settings {
  weightSteps: number[];
}

export interface Data {
  version: 1;
  programmes: Programme[];
  workouts: Workout[];
  settings: Settings;
}
