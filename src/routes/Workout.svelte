<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { formatDuration } from '../lib/duration.ts';
  import ValueSheet from '../components/ValueSheet.svelte';
  import { db, getWorkout, removeWorkout } from '../lib/state.svelte.ts';
  import { activityAmount, recordsKg, valuesOf, matchingValues, recordsWeights, fmtValues, copyValues, matchingText, recordsText, fmtNum, describe, flatten, fmtSecs, fmtValue, isComplete, matchingValue, neighbours, previousDone, resultOf, slotInfo, statusOf, unitOf, valueOf, type Unit } from '../lib/core.ts';
  import { fmtDay, fmtLong, isISODate, today as todayISO } from '../lib/dates.ts';
  import { go } from '../lib/router.svelte.ts';
  import { timer, type Phase } from '../lib/timer.svelte.ts';
  import { keepAwake } from '../lib/wakelock.ts';
  import type { Exercise, Feel, Superset, Workout } from '../lib/types.ts';

  let { id }: { id: string } = $props();

  const today = todayISO();
  const found = $derived(getWorkout(id));
  const around = $derived(found ? neighbours(db, found) : {});
  const last = $derived(found ? previousDone(db, found) : undefined);
  const slot = $derived(found ? slotInfo(db, found) : undefined);
  const status = $derived(found ? statusOf(found, today) : 'planned');

  const FEELS: { id: Feel; label: string; icon: string }[] = [
    { id: 'easy', label: 'Easy', icon: '🙂' },
    { id: 'hard', label: 'Hard', icon: '😣' },
    { id: 'failed', label: 'Failed', icon: '❌' },
  ];
  const STEPS: Record<Exclude<Unit, 'kg'>, number[]> = { s: [5, 10, 30], min: [1, 5, 10], km: [0.5, 1, 5], '×': [1, 5, 10] };

  let feelOpen = $state('');
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
    if (w.status === 'planned') w.startedAt ??= new Date().toISOString();
  };

  function openValue(ex: Exercise, slot = -1) {
    sheetFor = ex.id;
    sheetSlot = slot;
    sheetOpen = true;
  }

  function setFeel(w: Workout, ex: Exercise, feel: Feel) {
    const r = resultOf(w, ex.id);
    r.feel = r.feel === feel ? undefined : feel;
    feelOpen = '';
    touch(w);
  }

  /** Starts whatever rest follows the set that was just ticked. */
  function afterTick(w: Workout, ex: Exercise, sets: number, ss?: Superset) {
    const done = w.results[ex.id]?.setsDone ?? 0;
    let rest = 0;
    let label = `Rest after ${ex.name}`;
    if (ss) {
      const roundDone = ss.items.every((e) => (w.results[e.id]?.setsDone ?? 0) >= done);
      if (roundDone) rest = (done < ss.rounds ? ss.restBetweenRounds : ss.restAfter) ?? 0;
      label = done < ss.rounds ? `Rest before round ${done + 1} of ${ss.rounds}` : 'Rest after the superset';
    } else if (done < sets) {
      rest = ex.type === 'activity' ? 0 : (ex.restBetweenSets ?? 0);
      label = `${ex.name} · rest before set ${done + 1} of ${sets}`;
    } else {
      rest = ex.restAfter ?? 0;
    }
    if (rest > 0) timer.start([{ label, kind: 'rest', seconds: rest }]);
  }

  /** Sets and reps, without what's recorded: the value chip beside it already says that. */
  const plan = (ex: Exercise, inSuperset: boolean) => describe(ex, inSuperset).replace(/ · (weight|time|notes|\d+ weights)(?= · |$)/, '');

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

  /** One set of a timed exercise: `reps` rounds of work with the off time in between. */
  function rounds(ex: Extract<Exercise, { type: 'timed' }>, prefix: string, onDone: () => void): Phase[] {
    const phases: Phase[] = [];
    for (let i = 0; i < ex.reps; i++) {
      const last = i === ex.reps - 1;
      phases.push({ label: `On · ${prefix} · ${i + 1} of ${ex.reps}`, kind: 'work', seconds: ex.workSec, onEnd: last ? onDone : undefined });
      if (!last) phases.push({ label: `Off · ${prefix} · ${i + 1} of ${ex.reps}`, kind: 'rest', seconds: ex.restSec });
    }
    return phases;
  }

  /** Timed exercise: runs every remaining set, ticking each one off as it finishes. */
  function runIntervals(w: Workout, ex: Extract<Exercise, { type: 'timed' }>, sets: number, ss?: Superset) {
    touch(w);
    if (ss) {
      return timer.start(rounds(ex, ex.name, () => { resultOf(w, ex.id).setsDone++; afterTick(w, ex, sets, ss); }), ex.id);
    }
    const phases: Phase[] = [];
    for (let s = resultOf(w, ex.id).setsDone; s < sets; s++) {
      const prefix = sets > 1 ? `${ex.name} · set ${s + 1}` : ex.name;
      phases.push(...rounds(ex, prefix, () => (resultOf(w, ex.id).setsDone = s + 1)));
      phases.push({ label: s < sets - 1 ? `${ex.name} · rest before set ${s + 2} of ${sets}` : `Rest after ${ex.name}`, kind: 'rest', seconds: (s < sets - 1 ? ex.restBetweenSets : ex.restAfter) ?? 0 });
    }
    timer.start(phases, ex.id);
  }

  /** Hold (e.g. plank): counts down the recorded time, then ticks the set. */
  function runHold(w: Workout, ex: Exercise, sets: number, ss?: Superset) {
    const seconds = valueOf(w, ex);
    if (!seconds) return openValue(ex);
    touch(w);
    timer.start([{ label: ex.name, kind: 'work', seconds, onEnd: () => {
      const r = resultOf(w, ex.id);
      if (r.setsDone < sets) { r.setsDone++; afterTick(w, ex, sets, ss); }
    } }], ex.id);
  }

  function record(w: Workout, ex: Exercise | undefined, value: number) {
    if (!ex) return;
    const r = resultOf(w, ex.id);
    r.value = value;
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
    r.values = values;
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
      const now = w.results[ex.id]?.text?.trim();
      const before = matchingText(last, ex)?.trim();
      if (!now || !before) return '';
      return now === before ? 'Same as last' : `Last time: ${before}`;
    }
    const heaviest = (vs: (number | null)[] | undefined) => {
      const ns = (vs ?? []).filter((v): v is number => v !== null);
      return ns.length ? Math.max(...ns) : undefined;
    };
    const now = recordsWeights(ex) ? heaviest(w.results[ex.id]?.values) : w.results[ex.id]?.value;
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
          resultOf(w, ex.id).values = next;
          n++;
        }
      } else {
        const base = valueOf(w, ex) ?? matchingValue(last, ex);
        if (base === undefined) continue;
        resultOf(w, ex.id).value = step(base);
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
    Object.values(w.results).some((r) => r.value !== undefined || r.values?.some((v) => v !== null) || !!r.text || r.dumbbells);

  function clearRecorded(w: Workout) {
    if (!hasRecorded(w)) return (copied = 'Nothing recorded yet.');
    if (!confirm("Clear every weight, time, count and note recorded in this workout? Ticked sets and how it felt stay. This can't be undone.")) return;
    for (const { ex } of flatten(w.items)) {
      const r = w.results[ex.id];
      if (!r) continue;
      delete r.value;
      delete r.values;
      delete r.text;
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
    w.status = 'done';
    // A past or missed workout stays on its own day when ticked off later (it's being
    // logged, not done now). One done ahead of schedule moves to today; scheduledDate keeps the slot.
    if (w.date > today) w.date = today;
    timer.stop();
    go('/');
  }

  function reopen(w: Workout) {
    w.status = 'planned';
    w.completedAt = undefined;
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
    <a class="icon-btn" href="#/w/{w.id}/edit" aria-label="Edit this workout"><Icon name="edit" /></a>
  </header>

  <p class="when">
    {fmtLong(w.date)}{#if slot}{' · '}{slot.total ? `${slot.index} of ${slot.total}` : `No. ${slot.index}`}{/if}
    {#if status === 'done'}<span class="tag ok">Done</span>{/if}
    {#if status === 'missed'}<span class="tag bad">Missed</span>{/if}
  </p>

  <nav class="row around" aria-label="Other {w.name} workouts">
    {#if around.prev}<a class="btn small" href="#/w/{around.prev.id}"><Icon name="left" size={18} /> {fmtDay(around.prev.date)}</a>{/if}
    <span class="grow"></span>
    {#if around.next}<a class="btn small" href="#/w/{around.next.id}">{fmtDay(around.next.date)} <Icon name="right" size={18} /></a>{/if}
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
    <p class="vs" aria-hidden={!text}>{text || '\u00a0'}</p>
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
          <div class="progress" role="group" aria-label="{ex.name}: {done} of {sets} {ss ? 'rounds' : 'sets'} done">
            {#if sets > 1}<button class="adj" aria-label="One {ss ? 'round' : 'set'} fewer" aria-disabled={done === 0} onclick={() => stepSets(w, ex, sets, -1, ss)}>−</button>{/if}
            <button class="done" class:some={done > 0 && done < sets} class:on={done >= sets} aria-pressed={done >= sets} aria-label="{ex.name}: {done >= sets ? 'done, tap to undo' : 'mark all done'}" onclick={() => toggleDone(w, ex, sets, ss)}>
              {#if done >= sets}<Icon name="check" size={16} />{:else if done > 0}<span class="n">{done}</span>{/if}
            </button>
            {#if sets > 1}<button class="adj" aria-label="One more {ss ? 'round' : 'set'}" aria-disabled={done >= sets} onclick={() => stepSets(w, ex, sets, 1, ss)}>+</button>{/if}
          </div>
        {/if}
        <div class="title">
          <h3>{ex.name}</h3>
          <p class="desc">{plan(ex, !!ss)}{ex.description ? ` · ${ex.description}` : ''}</p>
        </div>
        <!-- The buttons, with the comparison line under them, form one column; the done control
             and the name sit centred against all of it. -->
        <div class="side">
        <div class="controls">
        {#if done < sets && timer.owner !== ex.id}
          {#if ex.type === 'timed'}
            <button class="icon-btn start" aria-label="Start {ex.name}" onclick={() => runIntervals(w, ex, sets, ss)}><Icon name="play" size={18} /></button>
          {:else if ex.type === 'reps' && ex.measure === 'time'}
            <button class="icon-btn start" aria-label="Start a {ex.name} timer" onclick={() => runHold(w, ex, sets, ss)}><Icon name="clock" size={18} /></button>
          {/if}
        {/if}
        <button class="icon-btn feel" aria-expanded={feelOpen === ex.id} aria-label={feel ? `Felt ${feel.label.toLowerCase()}. Change` : 'Set how it felt'} onclick={() => (feelOpen = feelOpen === ex.id ? '' : ex.id)}>
          {#if feel}<span aria-hidden="true">{feel.icon}</span>{:else}<Icon name="face" />{/if}
        </button>
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
      {#if feelOpen === ex.id}
        <div class="feels" role="group" aria-label="How did {ex.name} feel?">
          {#each FEELS as f}
            <button class="btn small {f.id}" aria-pressed={r?.feel === f.id} onclick={() => setFeel(w, ex, f.id)}><span aria-hidden="true">{f.icon}</span> {f.label}</button>
          {/each}
        </div>
      {/if}
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
          value={r?.text ?? ''} oninput={(e) => { resultOf(w, ex.id).text = e.currentTarget.value; touch(w); }}></textarea>
      {/if}
      {#if ex.type === 'activity'}
        {@const v = valueOf(w, ex) ?? 0}
        {@const amt = activityAmount(ex)}
        <div class="amount" role="group" aria-label="{ex.name}, {amt.unit}">
          <button class="step" aria-label="{amt.stepLabel} less" aria-disabled={!v} onclick={() => nudge(w, ex, -1)}>−</button>
          <button class="value" aria-label="{fmtValue(v, unit)}. Type a value" onclick={() => openValue(ex)}>
            <span class="num">{fmtNum(v)}</span><span class="unit">{amt.unit}</span>
          </button>
          <button class="step" aria-label="{amt.stepLabel} more" onclick={() => nudge(w, ex, 1)}>+</button>
        </div>
        {@render vs(ex)}
      {/if}
    </article>
  {/snippet}

  {#each w.items as item (item.id)}
    {#if item.type === 'superset'}
      <section class="superset" aria-label="Superset, {item.rounds} rounds">
        <p class="ss-head"><Icon name="repeat" size={16} /> Superset · {item.rounds} rounds{item.restBetweenRounds ? ` · rest ${formatDuration(item.restBetweenRounds)}` : ''}</p>
        {#each item.items as ex (ex.id)}{@render exercise(ex, item.rounds, item)}{/each}
      </section>
    {:else}
      {@render exercise(item, item.type === 'activity' ? 1 : item.sets)}
    {/if}
    {#if item.restAfter}
      <button class="rest-row" aria-label="Start {formatDuration(item.restAfter)} rest" onclick={() => timer.start([{ label: 'Rest', kind: 'rest', seconds: item.restAfter ?? 0 }])}>
        <Icon name="clock" size={16} /> Rest {formatDuration(item.restAfter)} <span class="grow"></span><Icon name="play" size={14} />
      </button>
    {/if}
  {:else}
    <div class="card"><p><strong>No exercises yet</strong></p><p class="muted">Add some with the edit button above.</p></div>
  {/each}

  <!-- The workout note only takes space once there is one, or you ask to add it. -->
  {#if w.notes || notesOpen}
    <!-- svelte-ignore a11y_autofocus -->
    <label class="field notes"><span>Notes</span><textarea bind:value={w.notes} rows="2" placeholder="Slept badly, shoulder felt tight" autofocus={notesOpen && !w.notes}></textarea></label>
  {:else}
    <button class="btn small add-note" onclick={() => (notesOpen = true)}><Icon name="edit" size={16} /> Add a note</button>
  {/if}

  {#if w.status === 'done'}
    <button class="btn wide" onclick={() => reopen(w)}>Mark as not done</button>
  {:else}
    <button class="btn wide" class:primary={isComplete(w)} onclick={() => finish(w)}>Finish workout</button>
  {/if}

  <details class="more">
    <summary>Move or delete</summary>
    <label class="field"><span>{w.status === 'done' ? 'Done on' : 'Planned for'}</span>
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
        <span class="t-time" role="timer" aria-live="off">{fmtSecs(timer.remaining)}{#if timer.paused}<span class="t-paused"> paused</span>{/if}</span>
      </div>
      <button class="icon-btn pause" aria-label={timer.paused ? 'Resume timer' : 'Pause timer'} onclick={() => (timer.paused ? timer.resume() : timer.pause())}>
        <Icon name={timer.paused ? 'play' : 'pause'} />
      </button>
      <button class="btn small" onclick={() => timer.add(15)}>+15 s</button>
      <button class="btn small" onclick={() => timer.skip()}>Skip</button>
      <button class="icon-btn" aria-label="Stop timer" onclick={() => timer.stop()}><Icon name="x" /></button>
    </div>
  {/if}

  {#if sheetEx && unitOf(sheetEx)}
    {@const unit = unitOf(sheetEx)!}
    <ValueSheet
      bind:open={sheetOpen}
      name={sheetSlot >= 0 ? `${sheetEx.name} · weight ${sheetSlot + 1}` : sheetEx.name}
      dumbbells={w.results[sheetEx.id]?.dumbbells}
      ondumbbells={recordsKg(sheetEx) ? (on) => setDumbbells(w, sheetEx, on) : undefined}
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
  .tag.ok { background: var(--ok); color: var(--ok-ink); }
  .tag.bad { background: var(--bad); color: var(--bad-ink); }
  .around { margin-bottom: 0.75rem; }
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
  .side .vs { margin: -0.25rem 0.25rem 0 0; width: 0; min-width: calc(100% - 0.25rem); }
  .title { flex: 1; min-width: 0; padding-left: 0.25rem; }
  .title h3 { margin: 0; font-size: 0.9375rem; line-height: 1.25; overflow-wrap: break-word; }
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
  .start { color: var(--accent); }
  .ex.complete { border-color: var(--ok-line); }
  .ex.running { border-color: var(--accent); }
  .feel { font-size: 1.25rem; color: var(--muted); }
  .chip { min-height: 2.25rem; padding: 0 0.875rem; border: none; border-radius: 99px; background: var(--raise); color: var(--text); font: inherit; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
  /* Under the weight, on the right: how it compares with last time. */
  .vs { margin: -0.25rem 0.25rem 0 0; text-align: right; font-size: 0.8125rem; line-height: 1.3; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-mark { display: inline-flex; vertical-align: -2px; margin-left: 0.25rem; color: var(--accent); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .chip.unset { background: transparent; box-shadow: inset 0 0 0 2px var(--line); color: var(--muted); }

  .feels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; padding: 0.375rem; background: var(--bg); border-radius: 12px; }
  .feels .btn[aria-pressed='true'].easy { background: var(--ok); color: var(--ok-ink); }
  .feels .btn[aria-pressed='true'].hard { background: var(--warn); color: var(--warn-ink); }
  .feels .btn[aria-pressed='true'].failed { background: var(--bad); color: var(--bad-ink); }


  .weights { flex-wrap: wrap; gap: 0.375rem; }
  .record { field-sizing: content; min-height: 2.75rem; resize: none; }
  .amount { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }
  .amount .step { flex: none; width: 3.25rem; height: 3.25rem; border: none; border-radius: 50%; background: var(--raise); color: var(--text); font: inherit; font-size: 1.75rem; font-weight: 600; line-height: 1; cursor: pointer; touch-action: manipulation; }
  .amount .step:hover { background: var(--line); }
  .amount .step[aria-disabled='true'] { color: var(--line); }
  .amount .value { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: center; gap: 0.375rem; min-height: 3.25rem; border: none; border-radius: 12px; background: none; color: var(--text); font: inherit; cursor: pointer; }
  .amount .value:hover { background: var(--raise); }
  .amount .num { font-size: 2rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; }
  .amount .unit { color: var(--muted); font-size: 0.875rem; }
  .superset { border: 2px dashed #7f77dd; border-radius: 22px; padding: 0.5rem 0.5rem 0; margin-bottom: 0.5rem; }
  .ss-head { display: flex; align-items: center; gap: 0.375rem; color: var(--accent); font-size: 0.8125rem; font-weight: 600; margin: 0 0.375rem 0.5rem; }

  /* The rest between two exercises: starts by itself when the one above is finished, or on tap. */
  .rest-row { display: flex; align-items: center; gap: 0.5rem; width: calc(100% - 2rem); min-height: 2.75rem; margin: 0 1rem 0.5rem; padding: 0 0.875rem; border: 2px dashed var(--line); border-radius: 99px; background: none; color: var(--muted); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .rest-row .grow { flex: 1; }

  .notes { margin-top: 1rem; }
  .add-note { margin: 0.75rem 0; }
  textarea { field-sizing: content; min-height: 4rem; resize: vertical; }
  .more { margin-top: 1.5rem; color: var(--muted); }
  .more summary { min-height: 2.75rem; display: flex; align-items: center; cursor: pointer; padding: 0 0.25rem; }
  .more > :not(summary) { margin-top: 0.5rem; }

  .spacer { height: 6rem; }
  .timer {
    position: fixed; z-index: 10; left: 50%; translate: -50% 0;
    bottom: calc(0.75rem + env(safe-area-inset-bottom)); width: min(calc(100% - 1.5rem), 32.5rem);
    display: flex; align-items: center; gap: 0.375rem;
    padding: 0.625rem 0.5rem 0.625rem 1rem; border-radius: 22px;
    background: var(--accent-deep); color: var(--text);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.5);
  }
  /* Green while working, red while resting: readable across the room. */
  .timer.work { background: var(--ok); color: var(--ok-ink); }
  .timer.rest { background: var(--bad); color: var(--bad-ink); }
  .timer .btn { background: rgb(0 0 0 / 0.22); color: inherit; }
  .timer .btn:hover { background: rgb(0 0 0 / 0.32); }
  .timer .icon-btn { color: inherit; }
  .timer .pause { background: rgb(0 0 0 / 0.22); }
  .t-paused { font-size: 0.875rem; font-weight: 600; }
  .timer .grow { display: grid; min-width: 0; }
  .t-label { font-size: 0.8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-time { font-size: 1.75rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
</style>
