// The timer's sounds. Each event gets its own shape, so it can be told apart without
// looking: rhythm and pitch direction carry more than pitch alone.
//
// - tick:   the 3, 2, 1 before a phase ends. One short, soft blip.
// - start:  work begins. Two quick notes going up (the "ready, go" of a race start),
//           the second landing on the moment itself.
// - stop:   rest begins. The same two notes going down, softer.
// - finish: the last phase is over. A rising four-note chime with a ringing tail.

let audio: AudioContext | undefined;
let wave: PeriodicWave | undefined;

export type Sound = 'tick' | 'start' | 'stop' | 'finish';

interface Note {
  /** Seconds from the moment the sound marks; negative notes come before it. */
  at: number;
  freq: number;
  /** How long it rings, in seconds. */
  dur: number;
  /** Relative loudness, 0 to 1. */
  gain: number;
}

// Notes from the A major scale around A5, high enough to carry on a phone speaker.
const E5 = 659.26, A5 = 880, CS6 = 1108.73, E6 = 1318.51, A6 = 1760;

const SOUNDS: Record<Sound, Note[]> = {
  tick: [{ at: 0, freq: A5, dur: 0.07, gain: 0.55 }],
  start: [
    { at: -0.1, freq: A5, dur: 0.09, gain: 0.75 },
    { at: 0, freq: E6, dur: 0.32, gain: 1 },
  ],
  stop: [
    { at: 0, freq: E6, dur: 0.1, gain: 0.8 },
    { at: 0.11, freq: A5, dur: 0.3, gain: 0.8 },
  ],
  finish: [
    { at: 0, freq: E5, dur: 0.14, gain: 0.8 },
    { at: 0.12, freq: A5, dur: 0.14, gain: 0.85 },
    { at: 0.24, freq: CS6, dur: 0.14, gain: 0.9 },
    { at: 0.36, freq: A6, dur: 0.6, gain: 1 },
  ],
};

/** How far before its moment a sound's first note plays, in seconds. */
export const soundLead = (s: Sound) => Math.max(0, -Math.min(...SOUNDS[s].map((n) => n.at)));

/** Sets up audio. Browsers only allow it from a tap, so call this from one. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No audio: the countdown still shows on screen.
  }
}

/**
 * Plays a sound whose moment is `inMs` from now (notes before the moment start earlier,
 * as far as now allows). Returns its oscillators, so it can be cancelled before it plays.
 */
export function playSound(s: Sound, volume: number, inMs = 0): OscillatorNode[] {
  if (volume <= 0) return [];
  unlockAudio();
  if (!audio) return [];
  try {
    const now = audio.currentTime;
    const moment = now + Math.max(soundLead(s), inMs / 1000);
    // Mostly a pure tone with a touch of the next two overtones: soft, but it still carries.
    wave ??= audio.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.15, 0.05]));
    const level = volume * volume; // Squared, so the slider feels even to the ear.
    return SOUNDS[s].map((n) => {
      const t = moment + n.at;
      const peak = 0.9 * level * n.gain;
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.setPeriodicWave(wave!);
      osc.frequency.value = n.freq;
      // A quick, click-free attack, a short hold, then a natural (exponential) fade like a struck bell.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      gain.gain.setValueAtTime(peak, t + Math.min(0.04, n.dur / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + n.dur + 0.02);
      return osc;
    });
  } catch {
    return [];
  }
}
