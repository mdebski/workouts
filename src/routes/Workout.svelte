<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import ValueSheet from '../components/ValueSheet.svelte';
  import { db, getWorkout, removeWorkout } from '../lib/state.svelte.ts';
  import { copyValues, describe, durationMin, flatten, fmtSecs, fmtValue, isComplete, matchingValue, neighbours, previousDone, resultOf, slotInfo, statusOf, unitOf, valueOf, type Unit } from '../lib/core.ts';
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
  const STEPS: Record<Exclude<Unit, 'kg'>, number[]> = { s: [5, 10, 30], min: [1, 5, 10], '×': [1, 5, 10] };

  let feelOpen = $state('');
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
    if (w.status === 'planned') w.startedAt ??= new Date().toISOString();
  };

  function openValue(ex: Exercise) {
    sheetFor = ex.id;
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
    if (ss) {
      const roundDone = ss.items.every((e) => (w.results[e.id]?.setsDone ?? 0) >= done);
      if (roundDone) rest = (done < ss.rounds ? ss.restBetweenRounds : ss.restAfter) ?? 0;
    } else if (done < sets) {
      rest = ex.type === 'reps' ? (ex.restBetweenSets ?? 0) : ex.type === 'timed' ? ex.restSec : 0;
    } else {
      rest = ex.restAfter ?? 0;
    }
    if (rest > 0) timer.start([{ label: 'Rest', kind: 'rest', seconds: rest }]);
  }

  function tick(w: Workout, ex: Exercise, sets: number, i: number, ss?: Superset) {
    const r = resultOf(w, ex.id);
    const before = r.setsDone;
    // Tapping the last ticked set unticks it; anything else ticks up to that set.
    r.setsDone = before === i + 1 ? i : i + 1;
    touch(w);
    if (r.setsDone > before) afterTick(w, ex, sets, ss);
    else timer.stop();
  }

  /** Timed exercise: runs work and rest for every remaining set, ticking as it goes. */
  function runIntervals(w: Workout, ex: Extract<Exercise, { type: 'timed' }>, sets: number, ss?: Superset) {
    touch(w);
    const r = resultOf(w, ex.id);
    if (ss) {
      return timer.start([{ label: ex.name, kind: 'work', seconds: ex.workSec, onEnd: () => { resultOf(w, ex.id).setsDone++; afterTick(w, ex, sets, ss); } }], ex.id);
    }
    const phases: Phase[] = [];
    for (let s = r.setsDone; s < sets; s++) {
      phases.push({ label: `${ex.name} · ${s + 1} of ${sets}`, kind: 'work', seconds: ex.workSec, onEnd: () => (resultOf(w, ex.id).setsDone = s + 1) });
      const rest = s < sets - 1 ? ex.restSec : (ex.restAfter ?? 0);
      phases.push({ label: 'Rest', kind: 'rest', seconds: rest });
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
    w.date = today; // recorded on the day it was actually done; scheduledDate keeps the slot
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
    {#if status === 'done'}<span class="tag ok">Done{durationMin(w) ? ` · ${durationMin(w)} min` : ''}</span>{/if}
    {#if status === 'missed'}<span class="tag bad">Missed</span>{/if}
  </p>

  <nav class="row around" aria-label="Other {w.name} workouts">
    {#if around.prev}<a class="btn small" href="#/w/{around.prev.id}"><Icon name="left" size={18} /> {fmtDay(around.prev.date)}</a>{/if}
    <span class="grow"></span>
    {#if around.next}<a class="btn small" href="#/w/{around.next.id}">{fmtDay(around.next.date)} <Icon name="right" size={18} /></a>{/if}
  </nav>

  {#if last && w.status !== 'done'}
    <button class="btn wide copy" onclick={() => copyLast(w)}><Icon name="copy" size={18} /> Same values as {fmtDay(last.date)}</button>
  {/if}
  <p class="muted status" role="status">{copied}</p>

  {#snippet exercise(ex: Exercise, sets: number, ss?: Superset)}
    {@const r = w.results[ex.id]}
    {@const done = r?.setsDone ?? 0}
    {@const unit = unitOf(ex)}
    {@const feel = FEELS.find((f) => f.id === r?.feel)}
    <article class="card ex" class:complete={done >= sets} class:running={timer.owner === ex.id}>
      <div class="row">
        <h3 class="grow">{ex.name}</h3>
        <button class="icon-btn feel" aria-expanded={feelOpen === ex.id} aria-label={feel ? `Felt ${feel.label.toLowerCase()}. Change` : 'Set how it felt'} onclick={() => (feelOpen = feelOpen === ex.id ? '' : ex.id)}>
          {#if feel}<span aria-hidden="true">{feel.icon}</span>{:else}<Icon name="face" />{/if}
        </button>
        {#if unit}<button class="chip" class:unset={valueOf(w, ex) === undefined} aria-label="{ex.name}: {fmtValue(valueOf(w, ex), unit)}. Change" onclick={() => openValue(ex)}>{fmtValue(valueOf(w, ex), unit)}</button>{/if}
      </div>
      {#if feelOpen === ex.id}
        <div class="feels" role="group" aria-label="How did {ex.name} feel?">
          {#each FEELS as f}
            <button class="btn small {f.id}" aria-pressed={r?.feel === f.id} onclick={() => setFeel(w, ex, f.id)}><span aria-hidden="true">{f.icon}</span> {f.label}</button>
          {/each}
        </div>
      {/if}
      <p class="muted">{describe(ex, !!ss)}{ex.description ? ` · ${ex.description}` : ''}</p>
      <div class="row sets">
        {#each { length: sets } as _, i}
          <button class="set" class:on={i < done} aria-pressed={i < done} aria-label="{ex.name}, {ss ? 'round' : 'set'} {i + 1} of {sets}" onclick={() => tick(w, ex, sets, i, ss)}>
            {#if i < done}<Icon name="check" size={18} />{:else}{i + 1}{/if}
          </button>
        {/each}
        <span class="grow"></span>
        {#if done < sets && timer.owner !== ex.id}
          {#if ex.type === 'timed'}
            <button class="btn small" onclick={() => runIntervals(w, ex, sets, ss)}><Icon name="play" size={16} /> Go</button>
          {:else if ex.type === 'reps' && ex.measure === 'time'}
            <button class="btn small" onclick={() => runHold(w, ex, sets, ss)}><Icon name="clock" size={16} /> Timer</button>
          {/if}
        {/if}
      </div>
    </article>
  {/snippet}

  {#each w.items as item (item.id)}
    {#if item.type === 'superset'}
      <section class="superset" aria-label="Superset, {item.rounds} rounds">
        <p class="ss-head"><Icon name="repeat" size={16} /> Superset · {item.rounds} rounds{item.restBetweenRounds ? ` · rest ${item.restBetweenRounds} s` : ''}</p>
        {#each item.items as ex (ex.id)}{@render exercise(ex, item.rounds, item)}{/each}
      </section>
    {:else}
      {@render exercise(item, item.type === 'activity' ? 1 : item.sets)}
    {/if}
  {:else}
    <div class="card"><p><strong>No exercises yet</strong></p><p class="muted">Add some with the edit button above.</p></div>
  {/each}

  <label class="field notes"><span>Notes</span><textarea bind:value={w.notes} rows="2" placeholder="Slept badly, shoulder felt tight"></textarea></label>

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
        <span class="t-time" role="timer" aria-live="off">{fmtSecs(timer.remaining)}</span>
      </div>
      <button class="btn small" onclick={() => timer.add(15)}>+15 s</button>
      <button class="btn small" onclick={() => timer.skip()}>Skip</button>
      <button class="icon-btn" aria-label="Stop timer" onclick={() => timer.stop()}><Icon name="x" /></button>
    </div>
  {/if}

  {#if sheetEx && unitOf(sheetEx)}
    {@const unit = unitOf(sheetEx)!}
    <ValueSheet
      bind:open={sheetOpen}
      name={sheetEx.name}
      {unit}
      value={valueOf(w, sheetEx)}
      last={matchingValue(last, sheetEx)}
      steps={unit === 'kg' ? db.settings.weightSteps : STEPS[unit]}
      onset={(v) => { resultOf(w, sheetFor).value = v; touch(w); }}
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
  .copy { margin-bottom: 0.25rem; }
  .status { min-height: 1.25rem; margin: 0 0.25rem 0.25rem; }

  .ex { border: 2px solid transparent; display: grid; gap: 0.375rem; }
  .ex.complete { border-color: var(--ok-line); }
  .ex.running { border-color: var(--accent); }
  .feel { font-size: 1.25rem; color: var(--muted); }
  .chip { min-height: 2.25rem; padding: 0 0.875rem; border: none; border-radius: 99px; background: var(--raise); color: var(--text); font: inherit; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
  .chip.unset { background: transparent; box-shadow: inset 0 0 0 2px var(--line); color: var(--muted); }

  .feels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; padding: 0.375rem; background: var(--bg); border-radius: 12px; }
  .feels .btn[aria-pressed='true'].easy { background: var(--ok); color: var(--ok-ink); }
  .feels .btn[aria-pressed='true'].hard { background: var(--warn); color: var(--warn-ink); }
  .feels .btn[aria-pressed='true'].failed { background: var(--bad); color: var(--bad-ink); }

  .sets { flex-wrap: wrap; gap: 0.375rem; margin-top: 0.25rem; }
  .set { display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 2px solid var(--line); background: none; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
  .set.on { background: var(--ok); border-color: var(--ok); color: var(--ok-ink); }

  .superset { border: 2px dashed #7f77dd; border-radius: 22px; padding: 0.5rem 0.5rem 0; margin-bottom: 0.5rem; }
  .ss-head { display: flex; align-items: center; gap: 0.375rem; color: var(--accent); font-size: 0.8125rem; font-weight: 600; margin: 0 0.375rem 0.5rem; }

  .notes { margin-top: 1rem; }
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
  .timer.work { background: var(--accent); color: var(--accent-ink); }
  .timer.work .btn { background: var(--accent-ink); color: var(--text); }
  .timer.work .icon-btn { color: var(--accent-ink); }
  .timer.rest .btn { background: #534ab7; }
  .timer .grow { display: grid; min-width: 0; }
  .t-label { font-size: 0.8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-time { font-size: 1.75rem; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
</style>
