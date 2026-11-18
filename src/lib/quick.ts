// Quick entry: one exercise per line, in the shorthand people already write.
//
//   Pull-ups 4x6          4 sets of 6 reps
//   Bench 5;5;10          3 sets with varying reps: 5, 5 and 10
//   Plank 3x hold         3 holds, hold time recorded each workout
//   Dead hang 6x5/5       6 rounds of 5 s on, 5 s off
//   Warm-up min           an activity: minutes are recorded when it's done
//   Jumping jacks count   an activity: a count is recorded when it's done
//   Run km                an activity: a distance in km is recorded when it's done
//   Rest 90s              a rest of its own, with a timer
//   Rows                  just a name: sets and reps copied from the defaults

import { uid } from './core.ts';
import { parseDuration } from './duration.ts';
import type { Exercise, RepsExercise, Rest } from './types.ts';

export type QuickDefaults = Pick<RepsExercise, 'sets' | 'reps' | 'repScheme' | 'measure' | 'restBetweenSets' | 'weightCount'>;

const X = '\\s*[x×*]\\s*';
const NAME = '^(.+?)[\\s,:–-]+';
const RULES: [RegExp, (m: RegExpMatchArray, d: QuickDefaults) => Omit<Exercise, 'id' | 'name'>][] = [
  [new RegExp(`${NAME}(?:(\\d+)${X})?(\\d+)${X}(\\d+)\\s*s?\\s*/\\s*(\\d+)\\s*s?$`, 'i'),
    (m) => ({ type: 'timed', reps: Number(m[2] ?? 1) * Number(m[3]), workSec: Number(m[4]), restSec: Number(m[5]), trackWeight: false })],
  [new RegExp(`${NAME}(\\d+(?:\\s*[;/]\\s*\\d+)+)$`, 'i'), (m, d) => {
    const scheme = m[2].split(/\s*[;/]\s*/).map(Number);
    return { type: 'reps', sets: scheme.length, reps: scheme[0], repScheme: scheme, measure: d.measure === 'time' ? 'weight' : d.measure, weightCount: d.weightCount, restBetweenSets: d.restBetweenSets };
  }],
  [new RegExp(`${NAME}(\\d+)${X}hold$`, 'i'), (m) => ({ type: 'reps', sets: Number(m[2]), reps: 1, measure: 'time' })],
  [new RegExp(`${NAME}(\\d+)${X}(\\d+)$`, 'i'), (m, d) => ({ type: 'reps', sets: Number(m[2]), reps: Number(m[3]), measure: d.measure === 'time' ? 'weight' : d.measure, restBetweenSets: d.restBetweenSets })],
  // Activities have no preset amount; a number written before "min" or on its own is accepted and ignored.
  [new RegExp(`${NAME}(?:\\d+(?:[.,]\\d+)?\\s*)?min(?:ute)?s?$`, 'i'), () => ({ type: 'activity', measure: 'time' })],
  [new RegExp(`${NAME}(?:\\d+(?:[.,]\\d+)?\\s*)?km$`, 'i'), () => ({ type: 'activity', measure: 'distance' })],
  [new RegExp(`${NAME}(?:count|[x×]?\\s*\\d+\\s*[x×]?)$`, 'i'), () => ({ type: 'activity', measure: 'count' })],
];

const clamp = (n: number, max: number) => Math.min(max, Math.max(1, Math.round(n)));

export function parseQuickLine(line: string, defaults: QuickDefaults): Exercise | Rest | undefined {
  const text = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
  if (!text) return undefined;
  // "Rest 90s", "rest: 2min": a rest of its own.
  const rest = text.match(/^rest\b[\s:,–-]*(.+)$/i);
  if (rest) {
    const seconds = parseDuration(rest[1]);
    if (seconds !== undefined && seconds > 0) return { id: uid(), type: 'rest', seconds: Math.min(3600, Math.round(seconds)) };
  }
  for (const [pattern, build] of RULES) {
    const m = text.match(pattern);
    if (!m) continue;
    const ex = { id: uid(), name: m[1].trim().slice(0, 80), ...build(m, defaults) } as Exercise;
    if (ex.type === 'reps') {
      Object.assign(ex, { sets: clamp(ex.sets, 99), reps: clamp(ex.reps, 999) });
      if (ex.repScheme) ex.repScheme = ex.repScheme.map((n) => clamp(n, 999));
    }
    if (ex.type === 'timed') Object.assign(ex, { reps: clamp(ex.reps, 99), workSec: clamp(ex.workSec, 3600), restSec: Math.min(3600, ex.restSec) });
    return ex;
  }
  return { id: uid(), name: text.slice(0, 80), type: 'reps', ...defaults };
}

export function parseQuick(text: string, defaults: QuickDefaults): (Exercise | Rest)[] {
  return text.split('\n').map((l) => parseQuickLine(l, defaults)).filter((e): e is Exercise | Rest => !!e);
}
