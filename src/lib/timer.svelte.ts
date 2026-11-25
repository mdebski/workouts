export interface Phase {
  label: string;
  /** prepare: a short count-in before work (e.g. getting into a hold). */
  kind: 'prepare' | 'work' | 'rest';
  seconds: number;
  onEnd?: () => void;
}

let audio: AudioContext | undefined;

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
 * A short tone. A square wave sounds far louder than a pure tone at the same level: its
 * overtones land where ears (and phone speakers) are most sensitive. It holds at full level
 * and only fades at the very end, rather than decaying from the start.
 */
export function beep(freq: number, ms: number, volume = beepVolume()): void {
  if (volume <= 0) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime;
    const end = t + ms / 1000;
    const level = 0.6 * volume * volume; // Squared, so the slider feels even to the ear.
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.005);
    gain.gain.setValueAtTime(level, Math.max(t + 0.005, end - 0.03));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(end);
  } catch {
    // No audio available: the on-screen countdown still works.
  }
}

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
  #lastTick = -1;

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
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  resume(): void {
    if (!this.current || !this.paused) return;
    this.#endsAt += Date.now() - this.#pausedAt;
    this.#pausedAt = 0;
    this.#now = Date.now();
    void audio?.resume();
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
    this.#lastTick = -1;
    void audio?.resume();
    beep(660, 120);
    this.#interval = setInterval(() => this.#tick(), 200);
  }

  stop(): void {
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
    this.#endsAt = Date.now();
    this.#tick();
  }

  add(seconds: number): void {
    if (this.current) this.#endsAt = Math.max(this.#pausedAt || Date.now(), this.#endsAt + seconds * 1000);
  }

  #tick(): void {
    this.#now = Date.now();
    while (this.current && this.#now >= this.#endsAt) {
      const run = this.#run;
      const ended = this.current;
      const last = this.index === this.phases.length - 1;
      beep(last || ended.kind === 'rest' ? 880 : 520, 350);
      navigator.vibrate?.(last ? [200, 100, 200] : 200);
      ended.onEnd?.();
      if (run !== this.#run) return; // onEnd started a different timer
      if (last) return this.stop();
      this.index++;
      this.#endsAt += this.phases[this.index].seconds * 1000;
      this.#lastTick = -1;
    }
    const secs = Math.ceil(this.remaining);
    if (secs <= 3 && secs > 0 && secs !== this.#lastTick) {
      this.#lastTick = secs;
      beep(440, 80);
    }
  }
}

export const timer = new Timer();
