// Sharing a programme as a link. The programme travels in the URL fragment, which
// browsers never send to a server. Whatever arrives is untrusted, so it is rebuilt
// field by field rather than used as-is.

import { uid } from './core.ts';
import { isISODate } from './dates.ts';
import type { End, Exercise, ISODate, Item, Programme, Repeat } from './types.ts';

const MAX_ITEMS = 60;
const MAX_PAYLOAD = 20_000;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const rest = (v: unknown) => (typeof v === 'number' && v > 0 ? int(v, 1, 3600, 60) : undefined);

function exercise(v: unknown): Exercise {
  if (!isObj(v)) throw new Error('bad exercise');
  const name = str(v.name, 80);
  if (!name) throw new Error('exercise without a name');
  const base = { id: uid(), name, description: str(v.description, 300) || undefined, restAfter: rest(v.restAfter) };
  if (v.type === 'reps') {
    const measure = v.measure === 'weight' || v.measure === 'weights' || v.measure === 'time' || v.measure === 'text' ? v.measure : 'none';
    const scheme = Array.isArray(v.repScheme) ? v.repScheme.slice(0, 20).map((n) => int(n, 1, 999, 1)) : [];
    return {
      ...base, type: 'reps',
      sets: scheme.length || int(v.sets, 1, 99, 1), reps: scheme[0] ?? int(v.reps, 1, 999, 1),
      repScheme: scheme.length ? scheme : undefined,
      measure, weightCount: measure === 'weights' ? int(v.weightCount, 2, 6, 2) : undefined,
      restBetweenSets: rest(v.restBetweenSets),
    };
  }
  if (v.type === 'timed') {
    // Older links carry sets of rounds (or, older still, rounds in `sets`): it's all rounds now.
    const reps = typeof v.reps === 'number' ? (typeof v.sets === 'number' ? v.sets * v.reps : v.reps) : v.sets;
    return { ...base, type: 'timed', reps: int(reps, 1, 99, 1), workSec: int(v.workSec, 1, 3600, 30), restSec: int(v.restSec, 0, 3600, 0), trackWeight: v.trackWeight === true };
  }
  if (v.type === 'activity') {
    return { ...base, type: 'activity', measure: v.measure === 'count' || v.measure === 'distance' ? v.measure : 'time' };
  }
  throw new Error('unknown exercise type');
}

function item(v: unknown): Item {
  if (isObj(v) && v.type === 'superset') {
    if (!Array.isArray(v.items)) throw new Error('bad superset');
    return { id: uid(), type: 'superset', rounds: int(v.rounds, 1, 99, 3), items: v.items.slice(0, MAX_ITEMS).map(exercise), restBetweenRounds: rest(v.restBetweenRounds), restAfter: rest(v.restAfter) };
  }
  return exercise(v);
}

function repeat(v: unknown): Repeat {
  if (isObj(v) && v.kind === 'interval') return { kind: 'interval', days: int(v.days, 1, 365, 1) };
  if (isObj(v) && v.kind === 'weekdays' && Array.isArray(v.days)) {
    const days = [...new Set(v.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (days.length) return { kind: 'weekdays', days };
  }
  throw new Error('bad schedule');
}

function end(v: unknown): End {
  if (isObj(v) && v.kind === 'count') return { kind: 'count', n: int(v.n, 1, 1000, 12) };
  if (isObj(v) && v.kind === 'weeks') return { kind: 'weeks', n: int(v.n, 1, 520, 4) };
  if (isObj(v) && v.kind === 'until' && isISODate(v.date)) return { kind: 'until', date: v.date };
  return { kind: 'never' };
}

/** Builds a fresh programme (new ids, not archived) from untrusted input, or throws. */
export function sanitiseProgramme(raw: unknown, today: ISODate): Programme {
  if (!isObj(raw) || !Array.isArray(raw.items) || !isObj(raw.schedule)) throw new Error('not a programme');
  const name = str(raw.name, 80);
  if (!name) throw new Error('programme without a name');
  const start = isISODate(raw.schedule.start) && raw.schedule.start > today ? raw.schedule.start : today;
  let ending = end(raw.schedule.end);
  // An end date that has already passed would add nothing, so drop it.
  if (ending.kind === 'until' && ending.date < start) ending = { kind: 'never' };
  return {
    id: uid(),
    name,
    emoji: str(raw.emoji, 8) || '💪',
    description: str(raw.description, 300) || undefined,
    items: raw.items.slice(0, MAX_ITEMS).map(item),
    schedule: { start, repeat: repeat(raw.schedule.repeat), end: ending },
    archived: false,
  };
}

// ---- Encoding --------------------------------------------------------------

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** `z.` = deflate-compressed JSON, `j.` = plain JSON (browsers without CompressionStream). */
export async function encodeProgramme(p: Programme): Promise<string> {
  // Ids are local and regenerated on import, so leave them out to keep the link short.
  const json = JSON.stringify({ name: p.name, emoji: p.emoji, description: p.description, items: p.items, schedule: p.schedule }, (k, v) => (k === 'id' ? undefined : v));
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return `j.${toBase64Url(bytes)}`;
  return `z.${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
}

export async function decodeProgramme(payload: string, today: ISODate): Promise<Programme> {
  if (payload.length > MAX_PAYLOAD) throw new Error('link too long');
  const [kind, body] = [payload.slice(0, 2), payload.slice(2)];
  let bytes: Uint8Array = fromBase64Url(body);
  if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j.') throw new Error('unknown link format');
  if (bytes.length > 200_000) throw new Error('link too large');
  return sanitiseProgramme(JSON.parse(new TextDecoder().decode(bytes)), today);
}

/** Pulls the programme payload out of a pasted share link (or a bare payload). */
export function extractPayload(text: string): string | undefined {
  return text.trim().match(/(?:^|#\/add\/)([zj]\.[A-Za-z0-9_-]+)\s*$/)?.[1];
}

/**
 * True in Safari on iPhone/iPad when not launched from the home screen. There the
 * installed app has separate storage, and links can't be made to open in it.
 */
export function isIOSBrowserTab(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return ios && !nav.standalone && !matchMedia('(display-mode: standalone)').matches;
}

export const shareUrl = (payload: string, base = location.href) => `${base.split('#')[0]}#/add/${payload}`;
