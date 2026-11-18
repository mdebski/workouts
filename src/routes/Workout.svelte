<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { formatDuration } from '../lib/duration.ts';
  import ValueSheet from '../components/ValueSheet.svelte';
  import { db, getProgramme, getWorkout, removeWorkout } from '../lib/state.svelte.ts';
  import { clone, hasRecorded as resultHasRecorded, numberOf, numbersOf, textOf, activityAmount, describePlan, exerciseFinished, recordsKg, valuesOf, matchingValues, recordsWeights, fmtValues, copyValues, matchingText, recordsText, fmtNum, describe, flatten, fmtSecs, fmtValue, isComplete, matchingValue, neighbours, previousDone, resultOf, statusOf, unitOf, valueOf, type Unit } from '../lib/core.ts';
  import { fmtDay, fmtLong, isISODate, today as todayISO } from '../lib/dates.ts';
  import { go } from '../lib/router.svelte.ts';
  import { timer, type Phase } from '../lib/timer.svelte.ts';
  import { keepAwake } from '../lib/wakelock.ts';
  import type { Exercise, Feel, Item, Rest, Superset, Workout } from '../lib/types.ts';

  let { id }: { id: string } = $props();

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
  const STEPS: Record<Exclude<Unit, 'kg'>, number[]> = { s: [5, 10, 30], min: [1, 5, 10], km: [0.5, 1, 5], '×': [1, 5, 10] };

  let notesOpen = $state(false);
  let sheetOpen = $state(false);
  let sheetFor = $state('');
  /** Which of several weights the sheet edits, or -1 for the single value. */
  let sheetSlot = $state(-1);
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

  function openValue(ex: Exercise, slot = -1) {
    sheetFor = ex.id;
    sheetSlot = slot;
    sheetOpen = true;
  }

  function setFeel(w: Workout, ex: Exercise, feel: Feel | undefined) {
    const r = resultOf(w, ex.id);
    r.feel = feel;
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

  /** Hold (e.g. plank): counts down the recorded time, then ticks the set. */
  function runHold(w: Workout, ex: Exercise, sets: number, ss?: Superset) {
    const seconds = valueOf(w, ex);
    if (!seconds) return openValue(ex);
    touch(w);
    timer.start([{ label: `Get ready · ${ex.name}`, kind: 'prepare', seconds: 3 }, { label: `Hold · ${ex.name}`, kind: 'work', seconds, onEnd: () => {
      const r = resultOf(w, ex.id);
      if (r.setsDone < sets) { r.setsDone++; afterTick(w, ex, sets, ss, true); }
    } }], ex.id);
  }

  function record(w: Workout, ex: Exercise | undefined, value: number) {
    if (!ex) return;
    const r = resultOf(w, ex.id);
    r.recorded = value;
    touch(w);
    // An activity is done once any amount is recorded (every round, inside a superset), and undone at zero.
    if (ex.type === 'activity') {
      const sets = flatten(w.items).find((f) => f.ex.id === ex.id)?.sets ?? 1;
      const ss = w.items.find((it): it is Superset => it.type === 'superset' && it.items.some((e) => e.id === ex.id));
      const was = r.setsDone;
      r.setsDone = value > 0 ? sets : 0;
      if (r.setsDone > was) afterTick(w, ex, sets, ss);
    }
  }

  /** The − and + next to an activity's amount: one rep, or one minute. */
  function nudge(w: Workout, ex: Exercise, d: 1 | -1) {
    const next = (valueOf(w, ex) ?? 0) + d * activityAmount(ex).step;
    record(w, ex, Math.max(0, Math.round(next * 100) / 100));
  }

  function recordSlot(w: Workout, ex: Exercise, slot: number, value: number) {
    const r = resultOf(w, ex.id);
    const values = valuesOf(w, ex);
    values[slot] = value;
    r.recorded = values;
    touch(w);
  }

  const minStep = $derived(Math.min(...db.settings.weightSteps));

  /** The quick + next to a weight: one smallest step up, starting from last time's weight if none is set yet. */
  function bumpWeight(w: Workout, ex: Exercise, d: 1 | -1) {
    const base = valueOf(w, ex) ?? matchingValue(last, ex) ?? 0;
    record(w, ex, Math.max(0, Math.round((base + d * minStep) * 100) / 100));
  }

  /**
   * This workout's weight next to last time's, e.g. "Same as last" or "1.25 kg more than last".
   * With several weights, the heaviest is compared. Empty until both are known.
   */
  function vsLast(w: Workout, ex: Exercise): string {
    if (!last) return '';
    if (recordsText(ex)) {
      const now = textOf(w.results[ex.id])?.trim();
      const before = matchingText(last, ex)?.trim();
      if (!now || !before) return '';
      return now === before ? 'Same as last' : `Last time: ${before}`;
    }
    const heaviest = (vs: (number | null)[] | undefined) => {
      const ns = (vs ?? []).filter((v): v is number => v !== null);
      return ns.length ? Math.max(...ns) : undefined;
    };
    const now = recordsWeights(ex) ? heaviest(numbersOf(w.results[ex.id])) : numberOf(w.results[ex.id]);
    const before = recordsWeights(ex) ? heaviest(matchingValues(last, ex)) : matchingValue(last, ex);
    if (now === undefined || before === undefined) return '';
    const diff = Math.round((now - before) * 100) / 100;
    if (diff === 0) return 'Same as last';
    const up = diff > 0;
    const n = Math.abs(diff);
    switch (unitOf(ex)) {
      case 'kg': return `${fmtNum(n)} kg ${up ? 'added' : 'removed'}`;
      case 's': return `${formatDuration(n)} ${up ? 'longer' : 'shorter'} than last`;
      case 'min': return `${formatDuration(n * 60)} ${up ? 'longer' : 'shorter'} than last`;
      case 'km': return `${fmtNum(n)} km ${up ? 'further' : 'less'} than last`;
      case '×': return `${fmtNum(n)} ${up ? 'more' : 'fewer'} than last`;
      default: return '';
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
      if (recordsWeights(ex)) {
        const now = valuesOf(w, ex);
        const before = matchingValues(last, ex) ?? [];
        const next = now.map((v, i) => (v ?? before[i] ?? null) === null ? null : step((v ?? before[i])!));
        if (next.some((v) => v !== null)) {
          resultOf(w, ex.id).recorded = next;
          n++;
        }
      } else {
        const base = valueOf(w, ex) ?? matchingValue(last, ex);
        if (base === undefined) continue;
        resultOf(w, ex.id).recorded = step(base);
        n++;
      }
    }
    if (n) touch(w);
    copied = n ? `Added ${fmtNum(minStep)} kg to ${n} ${n === 1 ? 'exercise' : 'exercises'}.` : 'No weights to add to yet.';
  }

  function setDumbbells(w: Workout, ex: Exercise, on: boolean) {
    const r = resultOf(w, ex.id);
    if (on) r.dumbbells = true;
    else delete r.dumbbells;
    touch(w);
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
      delete r.recorded;
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
    <a class="icon-btn" href="#/" aria-label="Back to agenda"><Icon name="back" /></a>
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
    <span class="prev">{#if around.prev}<a class="btn small" href="#/w/{around.prev.id}"><Icon name="left" size={18} /> {fmtDay(around.prev.date)}</a>{/if}</span>
    <button class="done all" class:some={progress.done > 0 && progress.done < progress.total} class:on={progress.total > 0 && progress.done >= progress.total} aria-pressed={progress.total > 0 && progress.done >= progress.total}
      aria-label={progress.done >= progress.total ? 'Workout done. Tap to untick every exercise' : `Mark every exercise done (${progress.done} of ${progress.total} done)`} onclick={() => markAll(w)}>
      <!-- Just the state: tick when done, dotted ring when partly done, empty otherwise. -->
      {#if progress.total > 0 && progress.done >= progress.total}<Icon name="check" size={20} />{/if}
    </button>
    <span class="next">{#if around.next}<a class="btn small" href="#/w/{around.next.id}">{fmtDay(around.next.date)} <Icon name="right" size={18} /></a>{/if}</span>
  </nav>

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

  {#snippet exercise(ex: Exercise, sets: number, ss?: Superset)}
    {@const r = w.results[ex.id]}
    {@const done = r?.setsDone ?? 0}
    {@const unit = unitOf(ex)}
    {@const feel = FEELS.find((f) => f.id === r?.feel)}
    <article class="card ex" class:complete={done >= sets} class:running={timer.owner === ex.id}>
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
        <div class="title" class:inline={ex.type === 'activity'}>
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
          {:else if ex.type === 'reps' && ex.measure === 'time'}
            <button class="icon-btn start" aria-label="Start a {ex.name} hold" onclick={() => runHold(w, ex, sets, ss)}><Icon name="play" size={18} /></button>
          {/if}
        {/if}
        {#if recordsKg(ex) && !recordsWeights(ex)}
          <button class="adj" aria-label="{ex.name}: take off {fmtNum(minStep)} kg" aria-disabled={!(valueOf(w, ex) ?? matchingValue(last, ex))} onclick={() => bumpWeight(w, ex, -1)}>−</button>
        {/if}
        {#if unit && ex.type !== 'activity' && !recordsWeights(ex)}<button class="chip" class:unset={valueOf(w, ex) === undefined} aria-label="{ex.name}: {fmtValue(valueOf(w, ex), unit)}. Change" onclick={() => openValue(ex)}>{fmtValue(valueOf(w, ex), unit)}{#if recordsKg(ex)}{@render dumbbellMark(ex)}{/if}</button>{/if}
        {#if recordsKg(ex) && !recordsWeights(ex)}
          <button class="adj" aria-label="{ex.name}: add {fmtNum(minStep)} kg" onclick={() => bumpWeight(w, ex, 1)}>+</button>
        {/if}
        </div>
        {#if !recordsWeights(ex) && ex.type !== 'activity'}{@render vs(ex)}{/if}
        </div>
      </div>
      {#if recordsWeights(ex)}
        <div class="row weights" role="group" aria-label="{ex.name}: weights">
          {#each valuesOf(w, ex) as v, i}
            <button class="chip" class:unset={v === null} aria-label="{ex.name}, weight {i + 1}: {v === null ? 'not set' : `${fmtNum(v)} kg`}. Change" onclick={() => openValue(ex, i)}>{v === null ? '—' : fmtNum(v)}</button>
          {/each}
          <span class="muted">kg</span>{@render dumbbellMark(ex)}
        </div>
        {@render vs(ex)}
      {/if}
      {#if recordsText(ex)}
        {@const lastText = matchingText(last, ex)}
        <textarea class="record" rows="1" aria-label="{ex.name}: note for this workout" placeholder={lastText ? `Last time: ${lastText}` : 'Note: band, grip, variation…'}
          value={typeof r?.recorded === 'string' ? r.recorded : ''} oninput={(e) => { const res = resultOf(w, ex.id); if (e.currentTarget.value) res.recorded = e.currentTarget.value; else delete res.recorded; touch(w); }}></textarea>
      {/if}
      {#if ex.type === 'activity'}
        {@const v = valueOf(w, ex) ?? 0}
        {@const amt = activityAmount(ex)}
        <div class="amount" role="group" aria-label="{ex.name}, {amt.unit}">
          <button class="step" aria-label="{amt.stepLabel} less" aria-disabled={!v} onclick={() => nudge(w, ex, -1)}><Icon name="minus" size={24} /></button>
          <button class="value" aria-label="{fmtValue(v, unit)}. Type a value" onclick={() => openValue(ex)}>
            <span class="reading"><span class="num">{fmtNum(v)}</span><span class="unit">{amt.unit}</span></span>
          </button>
          <button class="step" aria-label="{amt.stepLabel} more" onclick={() => nudge(w, ex, 1)}><Icon name="plus" size={24} /></button>
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


  <details class="more">
    <summary>Move or delete</summary>
    <label class="field"><span>{isComplete(w) ? 'Done on' : 'Planned for'}</span>
      <input type="date" value={w.date} onchange={(e) => { if (isISODate(e.currentTarget.value)) w.date = e.currentTarget.value; }} />
    </label>
    {#if w.scheduledDate && w.scheduledDate !== w.date}<p class="muted">Originally scheduled for {fmtDay(w.scheduledDate)}.</p>{/if}
    <button class="btn danger wide" onclick={() => remove(w)}>Delete workout</button>
  </details>

  {#if timer.current}
    <div class="spacer"></div>
    <div class="timer {timer.current.kind}" role="group" aria-label="Timer">
      <div class="grow">
        <span class="t-label">{timer.current.label}</span>
        <span class="t-time" role="timer" aria-live="off">{fmtSecs(timer.remaining)}</span>
      </div>
      <button class="icon-btn pause" aria-label={timer.paused ? 'Resume timer' : 'Pause timer'} onclick={() => (timer.paused ? timer.resume() : timer.pause())}>
        <Icon name={timer.paused ? 'play' : 'pause'} size={26} />
      </button>
      <button class="icon-btn" aria-label="Skip to the next part" onclick={() => timer.skip()}><Icon name="skip" size={26} /></button>
      <button class="icon-btn" aria-label="Stop timer" onclick={() => timer.stop()}><Icon name="x" size={26} /></button>
    </div>
  {/if}

  {#if sheetEx && unitOf(sheetEx)}
    {@const unit = unitOf(sheetEx)!}
    <ValueSheet
      bind:open={sheetOpen}
      name={sheetSlot >= 0 ? `${sheetEx.name} · weight ${sheetSlot + 1}` : sheetEx.name}
      dumbbells={w.results[sheetEx.id]?.dumbbells}
      ondumbbells={recordsKg(sheetEx) ? (on) => setDumbbells(w, sheetEx, on) : undefined}
      feel={w.results[sheetEx.id]?.feel}
      onfeel={(f) => setFeel(w, sheetEx, f)}
      {unit}
      value={sheetSlot >= 0 ? (valuesOf(w, sheetEx)[sheetSlot] ?? undefined) : (valueOf(w, sheetEx) ?? (sheetEx.type === 'activity' ? 0 : undefined))}
      last={sheetSlot >= 0 ? (matchingValues(last, sheetEx)?.[sheetSlot] ?? undefined) : matchingValue(last, sheetEx)}
      steps={unit === 'kg' ? db.settings.weightSteps : STEPS[unit]}
      onset={(v) => (sheetSlot >= 0 ? recordSlot(w, sheetEx, sheetSlot, v) : record(w, sheetEx, v))}
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



  .weights { flex-wrap: wrap; gap: 0.375rem; }
  .record { field-sizing: content; min-height: 2.75rem; resize: none; }
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
  .more summary { min-height: 2.75rem; display: flex; align-items: center; cursor: pointer; padding: 0 0.25rem; }
  .more > :not(summary) { margin-top: 0.5rem; }

  .spacer { height: 8.5rem; }
  .timer {
    position: fixed; z-index: 10; left: 50%; translate: -50% 0;
    bottom: calc(0.75rem + env(safe-area-inset-bottom)); width: min(calc(100% - 1.5rem), 32.5rem);
    display: flex; align-items: center; gap: 0.5rem;
    padding: 1rem 0.75rem 1rem 1.25rem; border-radius: 26px;
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
  /* The label and time take the free space, so the buttons sit together on the right. */
  .timer .grow { flex: 1; display: grid; min-width: 0; }
  .t-label { font-size: 1rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-time { font-size: 3rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.05; }
</style>
