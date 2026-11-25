import { playSound, soundLead, unlockAudio, type Sound } from './sounds.ts';

export interface Phase {
  label: string;
  /** prepare: a short count-in before work (e.g. getting into a hold). */
  kind: 'prepare' | 'work' | 'rest';
  seconds: number;
  onEnd?: () => void;
}


const VOLUME_KEY = 'workouts:beep-volume';

/** How loud the timer beeps on this device, 0 (off) to 1. Loudest unless changed. */
export function beepVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    const n = v === null ? 1 : Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  } catch {
    return 1;
  }
}

export function setBeepVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    // Not saved: it stays at what it was.
  }
}

/**
 * Sounds play this much before what they mark: speakers (Bluetooth especially) lag, so
 * the sound arrives about when the phase actually ends.
 */
const LEAD_MS = 50;
/** How far ahead each tick schedules sounds: more than a tick, the lead and the longest pickup note. */
const LOOKAHEAD_MS = 500;

/** The sound for a phase ending: what comes next decides it. */
const endSound = (next: Phase | undefined): Sound => (!next ? 'finish' : next.kind === 'rest' ? 'stop' : 'start');

/**
 * Runs a sequence of countdown phases. Everything is derived from wall-clock
 * timestamps, so the display is right again after the page was in the background.
 */
class Timer {
  phases = $state<Phase[]>([]);
  index = $state(0);
  owner = $state('');
  #endsAt = $state(0);
  /** When the timer was paused, or 0 while running. */
  #pausedAt = $state(0);
  #now = $state(Date.now());
  #interval: ReturnType<typeof setInterval> | undefined;
  #run = 0;
  /** Sounds already scheduled, by what they mark, so each plays once; `from` is when its first note plays. */
  #beeps = new Map<string, { from: number; osc: OscillatorNode[] }>();

  get current(): Phase | undefined {
    return this.phases[this.index];
  }

  get remaining(): number {
    return Math.max(0, (this.#endsAt - (this.#pausedAt || this.#now)) / 1000);
  }

  get paused(): boolean {
    return this.#pausedAt !== 0;
  }

  /** Freezes the countdown; resuming carries on from the same second. */
  pause(): void {
    if (!this.current || this.paused) return;
    this.#pausedAt = Date.now();
    this.#cancelBeeps();
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  resume(): void {
    if (!this.current || !this.paused) return;
    this.#endsAt += Date.now() - this.#pausedAt;
    this.#pausedAt = 0;
    this.#now = Date.now();
    unlockAudio();
    this.#interval = setInterval(() => this.#tick(), 200);
  }

  /** Must be called from a user gesture the first time, so audio is allowed. */
  start(phases: Phase[], owner = ''): void {
    const list = phases.filter((p) => p.seconds > 0);
    this.stop();
    if (!list.length) return;
    this.#run++;
    this.phases = list;
    this.index = 0;
    this.owner = owner;
    this.#now = Date.now();
    this.#endsAt = this.#now + list[0].seconds * 1000;
    // Audio has to be set up during the tap that started the timer, even if nothing plays yet.
    unlockAudio();
    // A count-in starts quietly: its end is the sound that matters.
    if (list[0].kind !== 'prepare') playSound(list[0].kind === 'rest' ? 'stop' : 'start', beepVolume());
    this.#interval = setInterval(() => this.#tick(), 200);
  }

  stop(): void {
    this.#cancelBeeps();
    this.#beeps.clear();
    clearInterval(this.#interval);
    this.#interval = undefined;
    this.phases = [];
    this.index = 0;
    this.owner = '';
    this.#pausedAt = 0;
  }

  /** Ends the current phase now, as if it had run out. */
  skip(): void {
    if (!this.current) return;
    if (this.paused) this.resume();
    this.#cancelBeeps();
    this.#endsAt = Date.now();
    this.#tick();
  }

  add(seconds: number): void {
    if (!this.current) return;
    this.#cancelBeeps();
    this.#endsAt = Math.max(this.#pausedAt || Date.now(), this.#endsAt + seconds * 1000);
    if (!this.paused) this.#tick();
  }

  /** Plays a sound so it lands LEAD_MS before `at` (a wall-clock time), unless one is already set for `key`. */
  #soundAt(key: string, at: number, sound: Sound): void {
    if (this.#beeps.has(key)) return;
    const inMs = at - LEAD_MS - Date.now();
    this.#beeps.set(key, { from: Date.now() + Math.max(0, inMs - soundLead(sound) * 1000), osc: playSound(sound, beepVolume(), inMs) });
  }

  /** Silences beeps that haven't played yet, after the timing changed; they're set again on the next tick. */
  #cancelBeeps(): void {
    const now = Date.now();
    for (const [key, b] of this.#beeps) {
      if (b.from <= now) continue;
      for (const o of b.osc) {
        try {
          o.stop();
        } catch {
          // Already stopped.
        }
      }
      this.#beeps.delete(key);
    }
  }

  #tick(): void {
    this.#now = Date.now();
    while (this.current && this.#now >= this.#endsAt) {
      const run = this.#run;
      const ended = this.current;
      const last = this.index === this.phases.length - 1;
      // Normally set by an earlier tick; this plays it now if the page was asleep.
      this.#soundAt(`${run}:${this.index}:end`, this.#endsAt, endSound(this.phases[this.index + 1]));
      navigator.vibrate?.(last ? [200, 100, 200] : 200);
      ended.onEnd?.();
      if (run !== this.#run) return; // onEnd started a different timer
      if (last) return this.stop();
      this.index++;
      this.#endsAt += this.phases[this.index].seconds * 1000;
    }
    const phase = this.current;
    if (!phase) return;
    const horizon = this.#now + LOOKAHEAD_MS;
    const startedAt = this.#endsAt - phase.seconds * 1000;
    // The 3, 2, 1 count-down ticks (not during a count-in, nor right on the start sound), then the end of the phase.
    for (const n of phase.kind === 'prepare' ? [] : [3, 2, 1]) {
      const at = this.#endsAt - n * 1000;
      if (at <= horizon && at >= startedAt + 500 && at > this.#now - 1000) this.#soundAt(`${this.#run}:${this.index}:${n}`, at, 'tick');
    }
    if (this.#endsAt <= horizon) this.#soundAt(`${this.#run}:${this.index}:end`, this.#endsAt, endSound(this.phases[this.index + 1]));
  }
}

export const timer = new Timer();
