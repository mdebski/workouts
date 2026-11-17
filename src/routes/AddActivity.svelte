<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import EmojiPicks from '../components/EmojiPicks.svelte';
  import { db, saveWorkout } from '../lib/state.svelte.ts';
  import { fmtNum, uid } from '../lib/core.ts';
  import { isISODate, today as todayISO } from '../lib/dates.ts';
  import { formatDuration, parseDuration } from '../lib/duration.ts';
  import { go } from '../lib/router.svelte.ts';
  import type { ActivityExercise, Workout } from '../lib/types.ts';

  // A quick way to log one activity. Under the hood it is a one-off workout holding
  // a single activity, both with the same name.

  let { date: dateProp }: { date?: string } = $props();
  const today = todayISO();

  type Measure = ActivityExercise['measure'];
  const MEASURES: { id: Measure; label: string; unit: string; placeholder: string }[] = [
    { id: 'time', label: 'Time', unit: 'min', placeholder: '45, 1h 15min' },
    { id: 'distance', label: 'Distance', unit: 'km', placeholder: '5.2' },
    { id: 'count', label: 'Count', unit: 'times', placeholder: '30' },
  ];
  const EMOJI = ['🏃', '🚶', '🚴', '🏊', '🧘', '⚽', '🎾', '🧗', '⛷️', '🛶'];

  let name = $state('');
  let emoji = $state('🏃');
  let measure = $state<Measure>('time');
  let amount = $state('');
  let date = $state(untrack(() => (dateProp && isISODate(dateProp) ? dateProp : today)));
  let done = $state(untrack(() => date <= today));
  let notes = $state('');
  let error = $state('');
  let doneTouched = false;

  // Planning ahead is the usual reason to pick a future date, so follow the date until the box is ticked by hand.
  $effect(() => {
    const isPast = date <= today;
    if (!doneTouched) done = isPast;
  });

  /** Activities logged before, newest first, so a familiar name fills in the rest. */
  const previous = $derived.by(() => {
    const seen = new Map<string, { emoji: string; measure: Measure }>();
    const list = db.workouts.filter((w) => w.items.length === 1 && w.items[0].type === 'activity').sort((a, b) => b.date.localeCompare(a.date));
    for (const w of list) {
      const ex = w.items[0] as ActivityExercise;
      if (!seen.has(w.name)) seen.set(w.name, { emoji: w.emoji, measure: ex.measure });
    }
    return seen;
  });

  function onName() {
    const match = previous.get(name.trim());
    if (match) {
      emoji = match.emoji;
      measure = match.measure;
    }
  }

  const unit = $derived(MEASURES.find((m) => m.id === measure)!);

  /** The amount in the activity's unit: minutes, km or a count. Times accept units ("1h", "90s"). */
  function readAmount(): number | undefined {
    const text = amount.trim();
    if (!text) return undefined;
    if (measure === 'time') {
      const s = parseDuration(text, 'min');
      return s === undefined || Number.isNaN(s) ? NaN : Math.round((s / 60) * 100) / 100;
    }
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? (measure === 'count' ? Math.round(n) : n) : NaN;
  }

  function tidyAmount() {
    const v = readAmount();
    if (v === undefined || Number.isNaN(v)) return;
    amount = measure === 'time' ? formatDuration(v * 60) : fmtNum(v);
  }

  function save() {
    const value = readAmount();
    if (!name.trim()) return (error = 'Give the activity a name.');
    if (!isISODate(date)) return (error = 'Pick a date.');
    if (Number.isNaN(value)) return (error = measure === 'time' ? 'Enter a time like 45, 1h or 1h 15min.' : `Enter a number of ${unit.unit}.`);
    if (done && !value) return (error = `Enter how ${measure === 'count' ? 'many' : measure === 'distance' ? 'far' : 'long'}, or untick Done.`);

    const exId = uid();
    const now = new Date().toISOString();
    const w: Workout = {
      id: uid(),
      name: name.trim(),
      emoji: emoji.trim() || '🏃',
      date,
      status: done ? 'done' : 'planned',
      completedAt: done ? now : undefined,
      notes: notes.trim() || undefined,
      items: [{ id: exId, type: 'activity', name: name.trim(), measure }],
      results: value !== undefined ? { [exId]: { setsDone: done && value > 0 ? 1 : 0, value } } : {},
    };
    saveWorkout(w);
    go('/');
  }
</script>

<!-- Esc leaves the form without saving, like the ✕ button; an open sheet takes Esc first. -->
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && !document.querySelector('dialog[open]')) location.hash = '#/'; }} />

<header class="bar">
  <a class="icon-btn" href="#/" aria-label="Cancel"><Icon name="x" /></a>
  <h1 tabindex="-1">Add activity</h1>
  <button class="btn primary small" onclick={save}>Save</button>
</header>

<form onsubmit={(e) => { e.preventDefault(); save(); }}>
  <div class="row top">
    <label class="field icon"><span>Icon</span><input type="text" bind:value={emoji} autocomplete="off" /></label>
    <label class="field grow"><span>Name</span><input type="text" bind:value={name} onchange={onName} list="activity-names" autocomplete="off" placeholder="Run" /></label>
  </div>
  <datalist id="activity-names">{#each [...previous.keys()] as n}<option value={n}></option>{/each}</datalist>
  <EmojiPicks bind:value={emoji} options={EMOJI} />

  <fieldset>
    <legend>Record</legend>
    <div class="chips">
      {#each MEASURES as m}<label><input type="radio" name="measure" value={m.id} bind:group={measure} />{m.label}</label>{/each}
    </div>
  </fieldset>

  <label class="field">
    <span>{measure === 'time' ? 'How long' : measure === 'distance' ? 'How far' : 'How many'}</span>
    <span class="with-unit">
      <input type="text" inputmode={measure === 'time' ? 'text' : 'decimal'} bind:value={amount} onchange={tidyAmount} autocomplete="off" placeholder={unit.placeholder} />
      <span class="unit" aria-hidden="true">{unit.unit}</span>
    </span>
  </label>

  <div class="cols">
    <label class="field"><span>Date</span><input type="date" bind:value={date} /></label>
    <label class="check"><input type="checkbox" bind:checked={done} onchange={() => (doneTouched = true)} /> Done</label>
  </div>

  <label class="field"><span>Notes (optional)</span><input type="text" bind:value={notes} autocomplete="off" /></label>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button type="submit" class="btn primary wide">Save activity</button>
</form>

<style>
  .top { align-items: flex-start; }
  .icon { width: 4.5rem; flex: none; }
  .icon input { text-align: center; font-size: 1.25rem; padding-inline: 0.25rem; }
  .with-unit { position: relative; display: block; }
  .with-unit input { padding-right: 3.5rem; font-size: 1.25rem; font-weight: 600; }
  .with-unit .unit { position: absolute; right: 0.875rem; top: 50%; translate: 0 -50%; color: var(--muted); pointer-events: none; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; align-self: end; margin-bottom: 0.75rem; font-weight: 600; }
  .check input { width: 1.25rem; height: 1.25rem; }
</style>
