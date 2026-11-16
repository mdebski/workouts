<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import ItemsEditor from '../components/ItemsEditor.svelte';
  import { blankProgramme, blankWorkout, getProgramme, getWorkout, removeProgramme, removeWorkout, saveProgramme, saveWorkout } from '../lib/state.svelte.ts';
  import { clone } from '../lib/core.ts';
  import { go } from '../lib/router.svelte.ts';
  import { isISODate, today } from '../lib/dates.ts';
  import type { Item, Programme, Schedule, Workout } from '../lib/types.ts';

  let props: { kind: 'programme' | 'workout'; id: string; date?: string } = $props();
  // The parent re-creates this screen whenever the route changes, so the props are read once.
  const { kind, id, date } = untrack(() => ({ ...props }));

  const isProgramme = kind === 'programme';
  const isNew = id === 'new';
  const existing: Programme | Workout | undefined = isNew ? undefined : isProgramme ? getProgramme(id) : getWorkout(id);
  const source = existing ? clone($state.snapshot(existing) as Programme | Workout) : isProgramme ? blankProgramme() : blankWorkout(date && isISODate(date) ? date : today());

  let name = $state(source.name);
  let emoji = $state(source.emoji);
  let items = $state<Item[]>(source.items);
  let schedule = $state<Schedule>('schedule' in source ? source.schedule : blankProgramme().schedule);
  let workoutDate = $state('date' in source ? source.date : today());
  let archived = $state('archived' in source ? source.archived : false);
  let error = $state('');

  const EMOJI = ['💪', '🏋️', '🏃', '🧘', '🤸', '🏊', '🧗', '🚣🏻', '🌊', '🪨', '🖐', '🩻'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const backHref = isProgramme ? '#/programmes' : isNew ? '#/' : `#/w/${id}`;
  const title = isProgramme ? (isNew ? 'New programme' : 'Edit programme') : isNew ? 'New workout' : 'Edit workout';

  function setRepeat(k: 'weekdays' | 'interval') {
    if (schedule.repeat.kind !== k) schedule.repeat = k === 'weekdays' ? { kind: k, days: [1, 3, 5] } : { kind: k, days: 2 };
  }

  function setEnd(k: string) {
    schedule.end = k === 'count' ? { kind: 'count', n: 12 } : k === 'until' ? { kind: 'until', date: schedule.start } : { kind: 'never' };
  }

  function validate(): string {
    if (!name.trim()) return 'Give it a name.';
    if (!isProgramme) return isISODate(workoutDate) ? '' : 'Pick a date.';
    if (!isISODate(schedule.start)) return 'Pick a start date.';
    const { repeat, end } = schedule;
    if (repeat.kind === 'weekdays' && repeat.days.length === 0) return 'Pick at least one day of the week.';
    if (repeat.kind === 'interval' && !(repeat.days >= 1)) return 'Repeat every 1 day or more.';
    if (end.kind === 'count' && !(end.n >= 1)) return 'The programme needs at least 1 workout.';
    if (end.kind === 'until' && (!isISODate(end.date) || end.date < schedule.start)) return 'The end date must be on or after the start date.';
    return '';
  }

  function save() {
    error = validate();
    if (error) return;
    const common = { name: name.trim(), emoji: emoji.trim() || '💪', items: clone($state.snapshot(items)) as Item[] };
    if (isProgramme) {
      const s = clone($state.snapshot(schedule)) as Schedule;
      if (s.repeat.kind === 'interval') s.repeat.days = Math.round(s.repeat.days);
      if (s.end.kind === 'count') s.end.n = Math.round(s.end.n);
      saveProgramme({ ...(source as Programme), ...common, schedule: s, archived });
      go('/programmes');
    } else {
      const w = { ...(source as Workout), ...common, date: workoutDate };
      saveWorkout(w);
      go(`/w/${w.id}`);
    }
  }

  function remove() {
    if (isProgramme) {
      if (!confirm(`Delete "${name}"? Planned and missed workouts are removed. Finished ones stay in your agenda.`)) return;
      removeProgramme(id);
      go('/programmes');
    } else {
      if (!confirm(`Delete this workout? This can't be undone.`)) return;
      removeWorkout(id);
      go('/');
    }
  }
</script>

<header class="bar">
  <a class="icon-btn" href={backHref} aria-label="Cancel"><Icon name="x" /></a>
  <h1 tabindex="-1">{title}</h1>
  <button class="btn primary small" onclick={save}>Save</button>
</header>

{#if !isNew && !existing}
  <div class="card"><p><strong>This {isProgramme ? 'programme' : 'workout'} no longer exists</strong></p><a class="btn" href={backHref}>Back</a></div>
{:else}
  <form onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="row top">
      <label class="field icon"><span>Icon</span><input type="text" bind:value={emoji} maxlength="8" autocomplete="off" aria-describedby="emoji-picks" /></label>
      <label class="field grow"><span>Name</span><input type="text" bind:value={name} autocomplete="off" placeholder={isProgramme ? 'Pull day' : 'Evening run'} /></label>
    </div>
    <div class="picks" id="emoji-picks" role="group" aria-label="Pick an icon">
      {#each EMOJI as e}<button type="button" class="pick" class:on={emoji === e} aria-pressed={emoji === e} onclick={() => (emoji = e)}>{e}</button>{/each}
    </div>

    {#if isProgramme}
      <h2>Schedule</h2>
      <div class="card">
        <fieldset>
          <legend>Repeats</legend>
          <div class="chips">
            <label><input type="radio" name="repeat" checked={schedule.repeat.kind === 'weekdays'} onchange={() => setRepeat('weekdays')} />On days of the week</label>
            <label><input type="radio" name="repeat" checked={schedule.repeat.kind === 'interval'} onchange={() => setRepeat('interval')} />Every few days</label>
          </div>
        </fieldset>
        {#if schedule.repeat.kind === 'weekdays'}
          <fieldset>
            <legend>Days</legend>
            <div class="chips">
              {#each DAYS as d, i}<label><input type="checkbox" value={i + 1} bind:group={schedule.repeat.days} />{d}</label>{/each}
            </div>
          </fieldset>
        {:else}
          <label class="field"><span>Every how many days (1 = daily)</span><input type="number" inputmode="numeric" min="1" bind:value={schedule.repeat.days} /></label>
        {/if}
        <div class="cols">
          <label class="field"><span>Starts</span><input type="date" bind:value={schedule.start} /></label>
          <label class="field">
            <span>Ends</span>
            <select value={schedule.end.kind} onchange={(e) => setEnd(e.currentTarget.value)}>
              <option value="count">After a number of workouts</option>
              <option value="until">On a date</option>
              <option value="never">Never</option>
            </select>
          </label>
        </div>
        {#if schedule.end.kind === 'count'}
          <label class="field"><span>Number of workouts (missed ones count)</span><input type="number" inputmode="numeric" min="1" bind:value={schedule.end.n} /></label>
        {:else if schedule.end.kind === 'until'}
          <label class="field"><span>Last day</span><input type="date" min={schedule.start} bind:value={schedule.end.date} /></label>
        {/if}
      </div>
    {:else}
      <label class="field"><span>Date</span><input type="date" bind:value={workoutDate} /></label>
    {/if}

    <h2>Exercises</h2>
    <ItemsEditor bind:items />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button type="submit" class="btn primary wide save">Save</button>

    {#if isProgramme && !isNew}
      <p class="muted note">Changes apply to workouts from today onwards. Finished and missed workouts keep what they had.</p>
      <label class="check"><input type="checkbox" bind:checked={archived} /> Archived (stops planning new workouts)</label>
    {/if}
    {#if !isNew}<button type="button" class="btn danger wide" onclick={remove}>Delete {isProgramme ? 'programme' : 'workout'}</button>{/if}
  </form>
{/if}

<style>
  .top { align-items: flex-start; }
  .icon { width: 4.5rem; flex: none; }
  .icon input { text-align: center; font-size: 1.25rem; padding-inline: 0.25rem; }
  .picks { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.5rem; }
  .pick { width: 2.75rem; height: 2.75rem; border-radius: 12px; border: 2px solid transparent; background: var(--card); font-size: 1.25rem; cursor: pointer; }
  .pick.on { border-color: var(--accent); }
  .card fieldset:last-child, .card .field:last-child { margin-bottom: 0; }
  .save { margin: 1rem 0; }
  .note { margin-bottom: 0.75rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin-bottom: 0.75rem; }
  .check input { width: 1.25rem; height: 1.25rem; }
</style>
