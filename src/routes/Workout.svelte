<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { formatDuration } from '../lib/duration.ts';
  import RecordSheet from '../components/RecordSheet.svelte';
  import { db, getProgramme, getWorkout, removeWorkout } from '../lib/state.svelte.ts';
  import { clone, hasRecorded as resultHasRecorded, describePlan, exerciseFinished, recordsKg, copyValues, fmtNum, flatten, fmtSecs, isComplete, matchingValueAt, neighbours, previousDone, resultOf, setValueAt, statusOf, valueAt } from '../lib/core.ts';
  import { fmtOne, gradeRank, isGradeKind, isNumberKind, kindLabel, paceOf } from '../lib/record.ts';
  import { fmtDay, fmtLong, isISODate, today as todayISO } from '../lib/dates.ts';
  import { go } from '../lib/router.svelte.ts';
  import { timer, type Phase } from '../lib/timer.svelte.ts';
  import { keepAwake } from '../lib/wakelock.ts';
  import type { Exercise, Feel, Item, RecordKind, RecordValue, Rest, Superset, Workout } from '../lib/types.ts';

  /** back: where the back arrow goes, when the workout was opened from search. */
  let { id, back }: { id: string; back?: string } = $props();
  const backHref = $derived(back?.startsWith('#/search') ? back : '#/');
  const backLabel = $derived(backHref === '#/' ? 'Back to agenda' : 'Back to search');
  /** Added to links to other workouts, so the back arrow still leads to the same place. */
  const keepBack = $derived(backHref === '#/' ? '' : `?back=${encodeURIComponent(backHref)}`);

  const today = todayISO();
  const found = $derived(getWorkout(id));
  const around = $derived(found ? neighbours(db, found) : {});
  const last = $derived(found ? previousDone(db, found) : undefined);
  const status = $derived(found ? statusOf(found, today) : 'planned');

  const FEELS: { id: Feel; label: string }[] = [
    { id: 'easy', label: 'Easy' },
    { id: 'hard', label: 'Hard' },
    { id: 'failed', label: 'Not finished' },
  ];
  /** The − / + steps in the value sheet. Times in seconds: short for holds, longer for activities. */
  const stepsFor = (ex: Exercise, k: RecordKind): number[] =>
    k === 'weight' ? db.settings.weightSteps : k === 'time' ? (ex.type === 'activity' ? [60, 300, 600] : [5, 10, 30]) : k === 'distance' ? [0.5, 1, 5] : [1, 5, 10];

  let notesOpen = $state(false);
  let moreOpen = $state(false);
  /** The sheet for everything recorded for one exercise, and which exercise it's open for. */
  let sheetOpen = $state(false);
  let sheetFor = $state('');
  let copied = $state('');
  const sheetEx = $derived(found ? flatten(found.items).find((f) => f.ex.id === sheetFor)?.ex : undefined);

  // Keep the screen on while a workout is open, so timers stay visible.
  onMount(() => {
    const release = keepAwake();
    return () => {
      release();
      timer.stop();
    };
  });

  const touch = (w: Workout) => {
    if (!isComplete(w)) w.startedAt ??= new Date().toISOString();
  };

  function openValue(ex: Exercise) {
    sheetFor = ex.id;
    sheetOpen = true;
  }

  /** Done in the record sheet: every value, how it felt and the dumbbell flag at once. */
  function saveSheet(w: Workout, ex: Exercise, r: { values: RecordValue[]; feel?: Feel; dumbbells: boolean }) {
    r.values.forEach((v, i) => setValueAt(w, ex, i, v));
    const res = resultOf(w, ex.id);
    if (r.feel) res.feel = r.feel;
    else delete res.feel;
    if (r.dumbbells && ex.record.includes('weight')) res.dumbbells = true;
    else delete res.dumbbells;
    if (ex.type === 'activity') res.setsDone = 0;
    touch(w);
  }

  /** Starts a rest item's timer; its card shows it running. */
  function startRest(r: Rest, label: string) {
    timer.start([{ label, kind: 'rest', seconds: r.seconds }], `rest:${r.id}`);
  }

  /**
   * Starts the rest between sets after a set was just done. Rests between exercises (rest
   * items) never start on their own: their card has a play button. A timer already running
   * is left alone, unless it is this exercise's own timer that has just ended (fromTimer).
   */
  function afterTick(w: Workout, ex: Exercise, sets: number, ss?: Superset, fromTimer = false) {
    if (ss || (timer.current && !fromTimer)) return;
    const done = w.results[ex.id]?.setsDone ?? 0;
    if (done >= sets) return;
    const rest = ex.type === 'reps' ? (ex.restBetweenSets ?? 0) : 0;
    if (rest > 0) timer.start([{ label: `${ex.name} · rest before set ${done + 1} of ${sets}`, kind: 'rest', seconds: rest }]);
  }

  /** Sets and reps, without what's recorded: the value chip beside it already says that. */
  const plan = describePlan;

  /** The − / + beside the done circle: one set more or fewer. A set more starts the rest that follows it. */
  function stepSets(w: Workout, ex: Exercise, sets: number, d: 1 | -1, ss?: Superset) {
    const r = resultOf(w, ex.id);
    const next = Math.min(sets, Math.max(0, r.setsDone + d));
    if (next === r.setsDone) return;
    r.setsDone = next;
    touch(w);
    if (d > 0) afterTick(w, ex, sets, ss);
    else if (timer.current?.kind === 'rest') timer.stop();
  }

  /** The one done button on an exercise: ticks every set (starting the rest after it), or clears them. */
  function toggleDone(w: Workout, ex: Exercise, sets: number, ss?: Superset) {
    const r = resultOf(w, ex.id);
    touch(w);
    if (r.setsDone >= sets) {
      r.setsDone = 0;
      if (timer.owner === ex.id || timer.current?.kind === 'rest') timer.stop();
      return;
    }
    r.setsDone = sets;
    afterTick(w, ex, sets, ss);
  }

  /**
   * Timed exercise: runs the remaining rounds of work and rest, counting each round as
   * its work ends; the rest after the exercise follows the last one. In a superset it
   * runs all the rounds once, as one superset round.
   */
  function runIntervals(w: Workout, ex: Extract<Exercise, { type: 'timed' }>, sets: number, ss?: Superset) {
    touch(w);
    const r = resultOf(w, ex.id);
    const from = ss ? 0 : r.setsDone;
    const phases: Phase[] = [];
    for (let i = from; i < ex.reps; i++) {
      const last = i === ex.reps - 1;
      const onEnd = ss
        ? last ? () => { resultOf(w, ex.id).setsDone++; afterTick(w, ex, sets, ss); } : undefined
        : () => { resultOf(w, ex.id).setsDone = i + 1; if (last) afterTick(w, ex, sets); };
      phases.push({ label: `On · ${ex.name} · ${i + 1} of ${ex.reps}`, kind: 'work', seconds: ex.workSec, onEnd });
      if (!last) phases.push({ label: `Off · ${ex.name} · ${i + 1} of ${ex.reps}`, kind: 'rest', seconds: ex.restSec });
    }
    // A few seconds to get into position first, as with holds.
    timer.start([{ label: `Get ready · ${ex.name}`, kind: 'prepare', seconds: 3 }, ...phases], ex.id);
  }

  /** Hold (e.g. plank): counts down the recorded time (the first one listed), then ticks the set. */
  function runHold(w: Workout, ex: Exercise, sets: number, ss?: Superset) {
    const slot = ex.record.indexOf('time');
    const seconds = valueAt(w, ex, slot);
    if (typeof seconds !== 'number' || !seconds) return openValue(ex);
    touch(w);
    timer.start([{ label: `Get ready · ${ex.name}`, kind: 'prepare', seconds: 3 }, { label: `Hold · ${ex.name}`, kind: 'work', seconds, onEnd: () => {
      const r = resultOf(w, ex.id);
      if (r.setsDone < sets) { r.setsDone++; afterTick(w, ex, sets, ss, true); }
    } }], ex.id);
  }

  /** Sets one entry. An activity's done-ness comes from its values alone, so no ticks are kept for it. */
  function record(w: Workout, ex: Exercise | undefined, slot: number, value: RecordValue) {
    if (!ex) return;
    setValueAt(w, ex, slot, value);
    if (ex.type === 'activity') resultOf(w, ex.id).setsDone = 0;
    touch(w);
  }

  /** How an activity's single amount is nudged by − / +: one, one minute, or half a km. */
  const nudgeStep = (k: RecordKind) => (k === 'time' ? 60 : k === 'distance' ? 0.5 : 1);
  const nudgeLabel = (k: RecordKind) => (k === 'time' ? 'one minute' : k === 'distance' ? '0.5 km' : 'one');

  function nudge(w: Workout, ex: Exercise, d: 1 | -1) {
    const k = ex.record[0];
    const now = valueAt(w, ex, 0);
    const next = (typeof now === 'number' ? now : 0) + d * nudgeStep(k);
    record(w, ex, 0, Math.max(0, Math.round(next * 100) / 100));
  }

  const minStep = $derived(Math.min(...db.settings.weightSteps));

  /** The quick + next to a weight: one smallest step up, starting from last time's weight if none is set yet. */
  function bumpWeight(w: Workout, ex: Exercise, slot: number, d: 1 | -1) {
    const now = valueAt(w, ex, slot);
    const before = matchingValueAt(last, ex, slot);
    const base = typeof now === 'number' ? now : typeof before === 'number' ? before : 0;
    record(w, ex, slot, Math.max(0, Math.round((base + d * minStep) * 100) / 100));
  }

  /**
   * How this workout compares with last time, on the first thing the exercise records:
   * "1.25 kg added", "Same as last", "1 grade harder"… With several weights, the heaviest
   * counts. Empty until both are known, and only between workouts of the same programme.
   */
  function vsLast(w: Workout, ex: Exercise): string {
    if (!last || !w.programmeId || last.programmeId !== w.programmeId || !ex.record.length) return '';
    const k = ex.record[0];
    const slots = ex.record.map((r, i) => (r === k ? i : -1)).filter((i) => i >= 0);
    if (k === 'note') {
      const now = valueAt(w, ex, 0);
      const before = matchingValueAt(last, ex, 0);
      if (typeof now !== 'string' || typeof before !== 'string' || !now.trim() || !before.trim()) return '';
      return now.trim() === before.trim() ? 'Same as last' : `Last time: ${before.trim()}`;
    }
    if (isGradeKind(k)) {
      const now = valueAt(w, ex, 0);
      const before = matchingValueAt(last, ex, 0);
      if (typeof now !== 'string' || typeof before !== 'string') return '';
      const diff = gradeRank(k, now) - gradeRank(k, before);
      if (diff === 0) return 'Same as last';
      return `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'grade' : 'grades'} ${diff > 0 ? 'harder' : 'easier'}`;
    }
    const nums = (vs: RecordValue[]) => vs.filter((v): v is number => typeof v === 'number');
    const pick = (vs: number[]) => (vs.length ? (k === 'weight' ? Math.max(...vs) : vs[0]) : undefined);
    const now = pick(nums(slots.map((i) => valueAt(w, ex, i))));
    const before = pick(nums(slots.map((i) => matchingValueAt(last, ex, i))));
    if (now === undefined || before === undefined) return '';
    const diff = Math.round((now - before) * 100) / 100;
    if (diff === 0) return 'Same as last';
    const up = diff > 0;
    const n = Math.abs(diff);
    switch (k) {
      case 'weight': return `${fmtNum(n)} kg ${up ? 'added' : 'removed'}`;
      case 'time': return `${formatDuration(n)} ${up ? 'longer' : 'shorter'} than last`;
      case 'distance': return `${fmtNum(n)} km ${up ? 'further' : 'less'} than last`;
      default: return `${fmtNum(n)} ${up ? 'more' : 'fewer'} than last`;
    }
  }

  const hasKg = $derived(found ? flatten(found.items).some(({ ex }) => recordsKg(ex)) : false);

  /**
   * Adds the smallest step to every weight in the workout. A weight with nothing
   * recorded yet starts from last time's; one with no history at all is left alone.
   */
  function bumpAll(w: Workout) {
    const step = (v: number) => Math.round((v + minStep) * 100) / 100;
    let n = 0;
    for (const { ex } of flatten(w.items)) {
      if (!recordsKg(ex)) continue;
      let changed = false;
      ex.record.forEach((k, i) => {
        if (k !== 'weight') return;
        const now = valueAt(w, ex, i);
        const base = typeof now === 'number' ? now : matchingValueAt(last, ex, i);
        if (typeof base !== 'number') return;
        setValueAt(w, ex, i, step(base));
        changed = true;
      });
      if (changed) n++;
    }
    if (n) touch(w);
    copied = n ? `Added ${fmtNum(minStep)} kg to ${n} ${n === 1 ? 'exercise' : 'exercises'}.` : 'No weights to add to yet.';
  }

  /** Whether anything was entered for this workout: weights, times, counts, notes or the dumbbell flag. */
  const hasRecorded = (w: Workout) =>
    Object.values(w.results).some((r) => resultHasRecorded(r) || r.dumbbells);

  function clearRecorded(w: Workout) {
    if (!hasRecorded(w)) return (copied = 'Nothing recorded yet.');
    if (!confirm("Clear every weight, time, count and note recorded in this workout? Ticked sets and how it felt stay. This can't be undone.")) return;
    for (const { ex } of flatten(w.items)) {
      const r = w.results[ex.id];
      if (!r) continue;
      delete r.values;
      delete r.dumbbells;
      // An activity is done only when an amount is recorded.
      if (ex.type === 'activity') r.setsDone = 0;
    }
    copied = 'Recorded values cleared.';
  }

  function copyLast(w: Workout) {
    if (!last) return;
    const n = copyValues(w, last);
    if (n) touch(w); // keeps the copied values if the programme is edited later
    copied = n ? `Copied ${n} ${n === 1 ? 'value' : 'values'}.` : 'Nothing to copy from that workout.';
  }

  function finish(w: Workout) {
    const now = new Date().toISOString();
    w.startedAt ??= now;
    w.completedAt = now;
    // A past or missed workout stays on its own day when ticked off later (it's being
    // logged, not done now). One done ahead of schedule moves to today; scheduledDate keeps the slot.
    if (w.date > today) w.date = today;
  }

  /** How many exercises are done, for the control between previous and next. */
  const progress = $derived.by(() => {
    const flat = found ? flatten(found.items) : [];
    return { total: flat.length, done: flat.filter((f) => exerciseFinished(found!.results[f.ex.id], f.ex, f.sets)).length };
  });

  /** The control between previous and next: ticks every exercise, or unticks them all once everything is done. */
  function markAll(w: Workout) {
    const flat = flatten(w.items);
    const all = isComplete(w);
    for (const { ex, sets } of flat) {
      // An activity counts as done by its recorded amount, so it isn't ticked from here.
      if (ex.type === 'activity') continue;
      resultOf(w, ex.id).setsDone = all ? 0 : sets;
    }
    touch(w);
    if (all) timer.stop();
  }

  // Done-ness itself is worked out from the results; this only notes when it was finished
  // (and moves a workout done ahead of schedule to today).
  let wasComplete: boolean | undefined;
  $effect(() => {
    const w = found;
    if (!w) return;
    const complete = isComplete(w);
    if (wasComplete === undefined || complete === wasComplete) {
      wasComplete = complete;
      return;
    }
    wasComplete = complete;
    untrack(() => {
      if (complete) finish(w);
      else reopen(w);
    });
  });

  function reopen(w: Workout) {
    w.completedAt = undefined;
  }

  /**
   * Puts the programme's current exercises back, undoing edits made to this workout.
   * Values for exercises that are still there stay; the rest are dropped.
   */
  function resetToProgramme(w: Workout) {
    const p = w.programmeId ? getProgramme(w.programmeId) : undefined;
    if (!p) return;
    if (!confirm(`Reset this workout to "${p.name}" as it is now? Exercises you added or changed here go back to the programme's; anything recorded for exercises that are no longer there is removed.`)) return;
    timer.stop();
    w.items = clone($state.snapshot(p.items) as Item[]);
    w.name = p.name;
    w.emoji = p.emoji;
    const ids = new Set(flatten(w.items).map((f) => f.ex.id));
    for (const id of Object.keys(w.results)) if (!ids.has(id)) delete w.results[id];
    copied = 'Reset to the programme.';
  }

  function remove(w: Workout) {
    if (!confirm(`Delete this workout? This can't be undone.`)) return;
    removeWorkout(w.id);
    go('/');
  }
</script>

{#if !found}
  <header class="bar"><a class="icon-btn" href="#/" aria-label="Back to agenda"><Icon name="back" /></a><h1 tabindex="-1">Workout not found</h1></header>
  <div class="card"><p class="muted">It may have been removed when its programme changed.</p></div>
{:else}
  {@const w = found}
  <header class="bar">
    <a class="icon-btn" href={backHref} aria-label={backLabel}><Icon name="back" /></a>
    <h1 tabindex="-1"><span aria-hidden="true">{w.emoji}</span> {w.name}</h1>
    {#if w.programmeId && getProgramme(w.programmeId)}
      <button class="icon-btn" aria-label="Reset this workout to the programme" title="Reset to the programme" onclick={() => resetToProgramme(w)}><Icon name="reset" /></button>
    {/if}
    <a class="icon-btn" href="#/w/{w.id}/edit" aria-label="Edit this workout"><Icon name="edit" /></a>
  </header>

  <p class="when">
    {fmtLong(w.date)}
    {#if status === 'missed'}<span class="tag bad">Missed</span>{/if}
  </p>

  <nav class="row around" aria-label="Other {w.name} workouts">
    <span class="prev">{#if around.prev}<a class="btn small" href="#/w/{around.prev.id}{keepBack}"><Icon name="left" size={18} /> {fmtDay(around.prev.date)}</a>{/if}</span>
    <button class="done all" class:some={progress.done > 0 && progress.done < progress.total} class:on={progress.total > 0 && progress.done >= progress.total} aria-pressed={progress.total > 0 && progress.done >= progress.total}
      aria-label={progress.done >= progress.total ? 'Workout done. Tap to untick every exercise' : `Mark every exercise done (${progress.done} of ${progress.total} done)`} onclick={() => markAll(w)}>
      <!-- Just the state: tick when done, dotted ring when partly done, empty otherwise. -->
      {#if progress.total > 0 && progress.done >= progress.total}<Icon name="check" size={20} />{/if}
    </button>
    <span class="next">{#if around.next}<a class="btn small" href="#/w/{around.next.id}{keepBack}">{fmtDay(around.next.date)} <Icon name="right" size={18} /></a>{/if}</span>
  </nav>

  {#if w.programmeId && getProgramme(w.programmeId)?.description}
    <!-- The programme's description, folded away until you want it. -->
    <details class="about">
      <summary>About {getProgramme(w.programmeId)?.name}</summary>
      <p>{getProgramme(w.programmeId)?.description}</p>
    </details>
  {/if}

  <div class="row tools">
    {#if last}<button class="btn small grow" onclick={() => copyLast(w)} title="Copy values from {fmtDay(last.date)}"><Icon name="copy" size={16} /> Copy last</button>{/if}
    {#if hasKg}<button class="btn small grow" onclick={() => bumpAll(w)} title="Add {fmtNum(minStep)} kg to every weight"><Icon name="plus" size={16} /> {fmtNum(minStep)} kg</button>{/if}
    <button class="btn small grow" onclick={() => clearRecorded(w)} aria-disabled={!hasRecorded(w)}><Icon name="x" size={16} /> Clear</button>
  </div>
  <p class="muted status" role="status">{copied}</p>

  <!-- Every card has this line, empty or not, so cards of the same kind are the same height. -->
  {#snippet vs(ex: Exercise)}
    {@const text = vsLast(w, ex)}
    {@const feel = FEELS.find((f) => f.id === w.results[ex.id]?.feel)}
    <p class="vs" aria-hidden={!text && !feel}>{#if feel}<span class="feel-dot {feel.id}" title="Felt {feel.label.toLowerCase()}"><span class="sr">Felt {feel.label.toLowerCase()}. </span></span>{/if}{text || '\u00a0'}</p>
  {/snippet}

  <!-- A rest item: its length and a timer (play, then pause / resume while it runs). -->
  {#snippet restCard(r: Rest, label: string)}
    {@const running = timer.owner === `rest:${r.id}` && !!timer.current}
    <div class="card rest-card" class:running>
      <span class="grow"><strong>Rest</strong> <span class="muted">{formatDuration(r.seconds)}</span></span>
      {#if running}
        <button class="icon-btn start" aria-label={timer.paused ? 'Resume rest' : 'Pause rest'} onclick={() => (timer.paused ? timer.resume() : timer.pause())}><Icon name={timer.paused ? 'play' : 'pause'} size={18} /></button>
      {:else}
        <button class="icon-btn start" aria-label="Start {formatDuration(r.seconds)} rest" onclick={() => startRest(r, label)}><Icon name="play" size={18} /></button>
      {/if}
    </div>
  {/snippet}

  {#snippet dumbbellMark(ex: Exercise)}
    {#if w.results[ex.id]?.dumbbells}<span class="db-mark" title="Dumbbells: weight per dumbbell"><Icon name="dumbbell" size={14} /><span class="sr">, dumbbells</span></span>{/if}
  {/snippet}

  <!-- One recorded value as a tappable chip: its value, or what it is while empty. -->
  {#snippet valueChip(ex: Exercise, i: number)}
    {@const k = ex.record[i]}
    {@const v = valueAt(w, ex, i)}
    {@const same = ex.record.filter((r) => r === k).length > 1}
    {@const what = same ? `${kindLabel(k).toLowerCase()} ${ex.record.slice(0, i + 1).filter((r) => r === k).length}` : kindLabel(k).toLowerCase()}
    {@const shown = v === null ? '' : fmtOne(k, v)}
    <button class="chip" class:unset={v === null} class:note={k === 'note'} aria-label="{ex.name}, {what}: {shown || 'not set'}. Change" onclick={() => openValue(ex)}>
      {shown || (k === 'weight' ? '— kg' : k === 'distance' ? '— km' : isGradeKind(k) ? (same ? `Grade ${ex.record.slice(0, i + 1).filter((r) => r === k).length}` : 'Grade') : kindLabel(k))}{#if k === 'weight'}{@render dumbbellMark(ex)}{/if}
    </button>
  {/snippet}

  {#snippet exercise(ex: Exercise, sets: number, ss?: Superset)}
    {@const r = w.results[ex.id]}
    {@const done = r?.setsDone ?? 0}
    {@const singleWeight = ex.record.length === 1 && ex.record[0] === 'weight'}
    {@const bigAmount = ex.type === 'activity' && ex.record.length === 1 && isNumberKind(ex.record[0])}
    {@const holdSlot = ex.type === 'reps' ? ex.record.indexOf('time') : -1}
    {@const pace = paceOf(ex, r)}
    <article class="card ex" class:complete={exerciseFinished(r, ex, sets)} class:running={timer.owner === ex.id}>
      <div class="head">
        {#if ex.type !== 'activity'}
          <div class="progress" role="group" aria-label="{ex.name}: {done} of {sets} {ss || ex.type === 'timed' ? 'rounds' : 'sets'} done">
            {#if sets > 1}<button class="adj" aria-label="One {ss || ex.type === 'timed' ? 'round' : 'set'} fewer" aria-disabled={done === 0} onclick={() => stepSets(w, ex, sets, -1, ss)}>−</button>{/if}
            <button class="done" class:some={done > 0 && done < sets} class:on={done >= sets} aria-pressed={done >= sets} aria-label="{ex.name}: {done >= sets ? 'done, tap to undo' : 'mark all done'}" onclick={() => toggleDone(w, ex, sets, ss)}>
              {#if done >= sets}<Icon name="check" size={16} />{:else if done > 0}<span class="n">{done}</span>{/if}
            </button>
            {#if sets > 1}<button class="adj" aria-label="One more {ss || ex.type === 'timed' ? 'round' : 'set'}" aria-disabled={done >= sets} onclick={() => stepSets(w, ex, sets, 1, ss)}>+</button>{/if}
          </div>
        {/if}
        <div class="title" class:inline={bigAmount}>
          <h3>{ex.name}</h3>
          <p class="desc">{plan(ex, !!ss)}{ex.description ? ` · ${ex.description}` : ''}</p>
        </div>
        <!-- The buttons, with the comparison line under them, form one column; the done control
             and the name sit centred against all of it. -->
        <div class="side">
        <div class="controls">
        {#if timer.owner === ex.id && timer.current}
          <!-- Its timer is running: the start button becomes pause / resume, same size and place. -->
          <button class="icon-btn start" aria-label={timer.paused ? `Resume ${ex.name}` : `Pause ${ex.name}`} onclick={() => (timer.paused ? timer.resume() : timer.pause())}>
            <Icon name={timer.paused ? 'play' : 'pause'} size={18} />
          </button>
        {:else if done < sets}
          {#if ex.type === 'timed'}
            <button class="icon-btn start" aria-label="Start {ex.name}" onclick={() => runIntervals(w, ex, sets, ss)}><Icon name="play" size={18} /></button>
          {:else if holdSlot >= 0}
            <button class="icon-btn start" aria-label="Start a {ex.name} hold" onclick={() => runHold(w, ex, sets, ss)}><Icon name="play" size={18} /></button>
          {/if}
        {/if}
        {#if singleWeight}
          {@const now = valueAt(w, ex, 0)}
          <button class="adj" aria-label="{ex.name}: take off {fmtNum(minStep)} kg" aria-disabled={!(typeof now === 'number' ? now : matchingValueAt(last, ex, 0))} onclick={() => bumpWeight(w, ex, 0, -1)}>−</button>
          {@render valueChip(ex, 0)}
          <button class="adj" aria-label="{ex.name}: add {fmtNum(minStep)} kg" onclick={() => bumpWeight(w, ex, 0, 1)}>+</button>
        {/if}
        </div>
        {#if singleWeight}{@render vs(ex)}{/if}
        </div>
      </div>
      {#if bigAmount}
        {@const k = ex.record[0]}
        {@const v = valueAt(w, ex, 0)}
        {@const n = typeof v === 'number' ? v : 0}
        <div class="amount" role="group" aria-label="{ex.name}, {kindLabel(k).toLowerCase()}">
          <button class="step" aria-label="{nudgeLabel(k)} less" aria-disabled={!n} onclick={() => nudge(w, ex, -1)}><Icon name="minus" size={24} /></button>
          <button class="value" aria-label="{fmtOne(k, n) || '0'}. Type a value" onclick={() => openValue(ex)}>
            <span class="reading">{#if k === 'time'}<span class="num">{n ? formatDuration(n) : '0'}</span>{#if !n}<span class="unit">min</span>{/if}{:else}<span class="num">{fmtNum(n)}</span><span class="unit">{k === 'distance' ? 'km' : 'times'}</span>{/if}</span>
          </button>
          <button class="step" aria-label="{nudgeLabel(k)} more" onclick={() => nudge(w, ex, 1)}><Icon name="plus" size={24} /></button>
        </div>
        {@render vs(ex)}
      {:else if !singleWeight && ex.record.length}
        <!-- Every value, notes too, as a chip; they're all typed in the record sheet. -->
        <div class="row values" role="group" aria-label="{ex.name}: recorded">
          {#each ex.record as _, i (i)}{@render valueChip(ex, i)}{/each}
          {#if pace}<span class="pace">{pace}</span>{/if}
        </div>
        {@render vs(ex)}
      {/if}
    </article>
  {/snippet}

  {#each w.items as item (item.id)}
    {#if item.type === 'superset'}
      <section class="superset" aria-label="Superset, {item.rounds} rounds">
        <p class="ss-head"><Icon name="repeat" size={16} /> Superset · {item.rounds} rounds</p>
        {#each item.items as step (step.id)}
          {#if step.type === 'rest'}{@render restCard(step, 'Rest before the next exercise')}{:else}{@render exercise(step, item.rounds, item)}{/if}
        {/each}
      </section>
    {:else if item.type === 'rest'}
      {@render restCard(item, 'Rest')}
    {:else}
      {@render exercise(item, item.type === 'activity' ? 1 : item.type === 'timed' ? item.reps : item.sets)}
    {/if}
  {:else}
    <div class="card"><p><strong>No exercises yet</strong></p><p class="muted">Add some with the edit button above.</p></div>
  {/each}

  <!-- The workout note only takes space once there is one, or you ask to add it. -->
  {#if w.notes || notesOpen}
    <!-- svelte-ignore a11y_autofocus -->
    <label class="field notes"><span>Notes</span><textarea bind:value={w.notes} rows="2" placeholder="Slept badly, shoulder felt tight" autofocus={notesOpen && !w.notes}></textarea></label>
  {:else}
    <button class="add-note" onclick={() => (notesOpen = true)}>Notes +</button>
  {/if}

  <details class="more" bind:open={moreOpen}>
    <summary><Icon name={moreOpen ? 'down' : 'right'} size={16} /> Move, copy or delete</summary>
    <label class="field"><span>{isComplete(w) ? 'Done on' : 'Planned for'}</span>
      <input type="date" value={w.date} onchange={(e) => { if (isISODate(e.currentTarget.value)) w.date = e.currentTarget.value; }} />
    </label>
    {#if w.scheduledDate && w.scheduledDate !== w.date}<p class="muted">Originally scheduled for {fmtDay(w.scheduledDate)}.</p>{/if}
    <a class="btn wide copy-of" href="#/w/new/edit?from={w.id}">{w.programmeId ? 'Copy as a one-off workout' : 'Create a copy'}</a>
    <button class="btn danger wide" onclick={() => remove(w)}>Delete workout</button>
  </details>

  {#if timer.current}
    <div class="spacer"></div>
    <div class="timer {timer.current.kind}" role="group" aria-label="Timer">
      <!-- What it is on its own line; below it the time, with the buttons beside it. -->
      <span class="t-label">{timer.current.label}</span>
      <div class="t-row">
      <span class="t-time" role="timer" aria-live="off">{fmtSecs(timer.remaining)}</span>
      <button class="icon-btn pause" aria-label={timer.paused ? 'Resume timer' : 'Pause timer'} onclick={() => (timer.paused ? timer.resume() : timer.pause())}>
        <Icon name={timer.paused ? 'play' : 'pause'} size={26} />
      </button>
      <button class="icon-btn" aria-label="Skip to the next part" onclick={() => timer.skip()}><Icon name="skip" size={26} /></button>
      <button class="icon-btn" aria-label="Stop timer" onclick={() => timer.stop()}><Icon name="x" size={26} /></button>
      </div>
    </div>
  {/if}

  {#if sheetEx}
    <RecordSheet
      bind:open={sheetOpen}
      ex={sheetEx}
      values={sheetEx.record.map((_, i) => valueAt(w, sheetEx, i))}
      last={sheetEx.record.map((_, i) => matchingValueAt(last, sheetEx, i))}
      feel={w.results[sheetEx.id]?.feel}
      dumbbells={w.results[sheetEx.id]?.dumbbells}
      stepOf={(k) => (k === 'weight' ? minStep : stepsFor(sheetEx, k)[0])}
      stepsOf={(k) => stepsFor(sheetEx, k)}
      onsave={(r) => saveSheet(w, sheetEx, r)}
    />
  {/if}
{/if}

<style>
  h3 { font-size: 1rem; font-weight: 600; }
  .when { color: var(--muted); font-size: 0.875rem; margin: 0 0.25rem 0.75rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .tag { padding: 0.125rem 0.625rem; border-radius: 99px; font-weight: 600; font-size: 0.8125rem; }
  .tag.bad { background: var(--bad); color: var(--bad-ink); }
  /* Previous, the whole-workout done control in the middle, next. */
  .around { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-bottom: 0.75rem; }
  .around .next { justify-self: end; }
  .done.all { width: 2.5rem; height: 2.5rem; margin: 0 0.5rem; }
  .tools { margin-bottom: 0.25rem; }
  .tools .btn { padding-inline: 0.5rem; }
  .status { min-height: 1.25rem; margin: 0 0.25rem 0.25rem; }

  .ex { border: 2px solid transparent; display: grid; gap: 0.25rem; padding: 0.5rem 0.625rem; }
  .head { display: flex; align-items: center; gap: 0.25rem; }
  .side { flex: none; display: grid; justify-items: end; }
  .controls { display: flex; align-items: center; gap: 0.125rem; }
  /* Slimmer buttons in the card header leave the exercise name room for whole words. */
  .controls :global(.icon-btn) { width: 2rem; }
  .controls .chip { padding: 0 0.625rem; }
  /* The comparison line takes the buttons' width rather than widening the column. */
  .side .vs { margin: 0.25rem 0.25rem 0 0; width: 0; min-width: calc(100% - 0.25rem); }
  .title { flex: 1; min-width: 0; padding-left: 0.25rem; }
  .title h3 { margin: 0; font-size: 0.9375rem; line-height: 1.25; overflow-wrap: break-word; }
  /* Activities: the short description follows the name on the same line. */
  .title.inline { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .title.inline h3 { flex: none; max-width: 60%; }
  .title.inline .desc { flex: 1; min-width: 0; margin: 0; text-align: right; }
  .desc { margin: 0.0625rem 0 0; font-size: 0.8125rem; color: var(--muted); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* One small round button per exercise: tap to mark the whole exercise done. */
  .progress { flex: none; display: flex; align-items: center; }
  .done { flex: none; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; margin: 0.5rem 0.125rem; padding: 0; border-radius: 50%; border: 2px solid var(--line); background: none; color: var(--ok-ink); font: inherit; line-height: 1; cursor: pointer; }
  .done:hover { border-color: var(--ok); }
  /* Some sets done: dotted ring with the count; all done: filled with a tick. */
  .done.some { border-style: dotted; border-color: var(--ok); color: var(--ok); }
  .done.on { background: var(--ok); border-color: var(--ok); }
  .done :global(svg), .done .n { display: block; }
  .n { font-size: 0.8125rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .adj { flex: none; width: 1.25rem; height: 2.75rem; padding: 0; border: none; background: none; color: var(--muted); font: inherit; font-size: 1.125rem; font-weight: 600; line-height: 1; cursor: pointer; }
  .adj:hover { color: var(--text); }
  .adj[aria-disabled='true'] { color: var(--line); pointer-events: none; }
  /* Play / pause on cards: a round 40 px button with no hover change. */
  .start, .controls .start { width: 2.5rem; height: 2.5rem; border-radius: 50%; color: var(--accent); }
  .start:hover, .controls .start:hover { background: none; }
  /* A timer running for this exercise: tinted green, like a running rest is tinted red. */
  .ex.running { background: color-mix(in srgb, var(--ok-line) 18%, var(--card)); }
  /* How it felt, as a small dot after the name (set in the value sheet). */
  .feel-dot { display: inline-block; width: 0.5rem; height: 0.5rem; margin-right: 0.375rem; border-radius: 50%; vertical-align: 0.1em; }
  .feel-dot.easy { background: var(--ok); }
  .feel-dot.hard { background: var(--warn); }
  .feel-dot.failed { background: var(--bad); }
  .chip { min-height: 2.25rem; padding: 0 0.875rem; border: none; border-radius: 99px; background: var(--raise); color: var(--text); font: inherit; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
  /* Under the weight, on the right: how it compares with last time. */
  .vs { margin: -0.25rem 0.25rem 0 0; text-align: right; font-size: 0.8125rem; line-height: 1.3; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-mark { display: inline-flex; vertical-align: -2px; margin-left: 0.25rem; color: var(--accent); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .chip.unset { background: transparent; box-shadow: inset 0 0 0 2px var(--line); color: var(--muted); }

  /* Everything recorded besides a single weight: a row of chips, with the pace after a time and a distance. */
  .values { flex-wrap: wrap; gap: 0.375rem; align-items: center; margin-top: 0.125rem; }
  .pace { font-size: 0.875rem; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
  /* A note's chip shows its start; the whole note is in the record sheet. */
  .values .chip.note { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .amount { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }
  /* Icons rather than − / + characters: font glyphs sit off-centre in a round button. */
  .amount .step { flex: none; display: grid; place-items: center; width: 3.25rem; height: 3.25rem; padding: 0; border: none; border-radius: 50%; background: var(--raise); color: var(--text); cursor: pointer; touch-action: manipulation; }
  .amount .step:hover { background: var(--line); }
  .amount .step[aria-disabled='true'] { color: var(--line); }
  .amount .value { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; min-height: 3.25rem; border: none; border-radius: 12px; background: none; color: var(--text); font: inherit; cursor: pointer; }
  .amount .value:hover { background: var(--raise); }
  /* The number and its unit share a baseline; together they're centred against the buttons. */
  .amount .reading { display: inline-flex; align-items: baseline; gap: 0.375rem; }
  .amount .num { font-size: 2rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; }
  .amount .unit { color: var(--muted); font-size: 0.875rem; }
  .superset { border: 2px dashed #7f77dd; border-radius: 22px; padding: 0.5rem 0.5rem 0; margin-bottom: 0.5rem; }
  /* Rest cards always carry the rest colour; a running one is filled with it too. */
  .rest-card { display: flex; align-items: center; gap: 0.5rem; min-height: 3.25rem; padding: 0.25rem 0.5rem 0.25rem 1rem; box-shadow: inset 4px 0 0 var(--bad-line); }
  .rest-card.running { background: color-mix(in srgb, var(--bad-line) 18%, var(--card)); }
  .rest-card .grow { flex: 1; }
  .ss-head { display: flex; align-items: center; gap: 0.375rem; color: var(--accent); font-size: 0.8125rem; font-weight: 600; margin: 0 0.375rem 0.5rem; }

  .notes { margin-top: 1rem; }
  .add-note { display: block; margin: 0.5rem 0; padding: 0.5rem 0.25rem; min-height: 2.75rem; border: none; background: none; color: var(--muted); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .add-note:hover { color: var(--text); }
  textarea { field-sizing: content; min-height: 4rem; resize: vertical; }
  .more { margin-top: 1.5rem; color: var(--muted); }
  .about { margin: 0.25rem 0 0.75rem; color: var(--muted); }
  .about summary { min-height: 2.75rem; display: flex; align-items: center; padding: 0 0.25rem; cursor: pointer; font-size: 0.875rem; font-weight: 600; }
  .about p { margin: 0 0.25rem 0.5rem; white-space: pre-line; overflow-wrap: anywhere; }
  .more summary { min-height: 2.75rem; display: flex; align-items: center; gap: 0.375rem; cursor: pointer; padding: 0 0.25rem; font-weight: 600; list-style: none; }
  .more summary::-webkit-details-marker { display: none; }
  .more > :not(summary) { margin-top: 0.5rem; }

  .spacer { height: 10rem; }
  .timer {
    position: fixed; z-index: 10; left: 50%; translate: -50% 0;
    bottom: calc(0.75rem + env(safe-area-inset-bottom)); width: min(calc(100% - 1.5rem), 32.5rem);
    display: grid; gap: 0.25rem;
    padding: 0.875rem 0.75rem 0.75rem 1.25rem; border-radius: 26px;
    background: var(--accent-deep); color: var(--text);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
  }
  /* Green while working, red while resting: readable across the room. */
  .timer.work { background: var(--ok); color: var(--ok-ink); }
  .timer.rest { background: var(--bad); color: var(--bad-ink); }
  /* The few seconds to get into position before a hold. */
  .timer.prepare { background: var(--warn); color: var(--warn-ink); }
  /* Every button on the bar: the same height, a dark wash over the bar colour and the bar's
     dark text, so they read on green and red alike (the plain icon-button hover is too dark here). */
  .timer .btn, .timer .icon-btn { min-height: 3.25rem; height: 3.25rem; background: rgb(0 0 0 / 0.22); color: inherit; }
  .timer .btn:hover, .timer .icon-btn:hover { background: rgb(0 0 0 / 0.34); }
  .timer .icon-btn { width: 3.25rem; }
  /* The time takes the free space, so the buttons sit together on the right. */
  .t-row { display: flex; align-items: center; gap: 0.5rem; }
  .t-row .t-time { flex: 1; min-width: 0; }
  .t-label { font-size: 1rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-time { font-size: 3rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.05; }
</style>
