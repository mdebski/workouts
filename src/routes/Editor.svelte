<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import ItemsEditor from '../components/ItemsEditor.svelte';
  import Fold from '../components/Fold.svelte';
  import EmojiPicks from '../components/EmojiPicks.svelte';
  import { describeEnd, describeRepeat } from '../lib/schedule.ts';
  import { db, rememberEmoji, blankProgramme, blankWorkout, getProgramme, getWorkout, removeProgramme, removeProgrammeAndWorkouts, removeWorkout, saveProgramme, saveWorkout } from '../lib/state.svelte.ts';
  import { clone, flatten, isLogged } from '../lib/core.ts';
  import { go } from '../lib/router.svelte.ts';
  import { isISODate, today } from '../lib/dates.ts';
  import type { Item, Programme, Result, Schedule, Workout } from '../lib/types.ts';

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
  let scheduleOpen = $state(true);
  let exercisesOpen = $state(true);
  // Workouts only: what was done, so a past session can be logged in one go.
  let results = $state<Record<string, Result>>('results' in source ? source.results : {});

  const count = $derived(flatten(items).length);

  let emojiInput = $state<HTMLInputElement>();
  let emojiHint = $state(false);

  /** The icon is a single emoji: whatever was typed or picked last replaces the previous one. */
  function onEmojiInput(e: Event & { currentTarget: HTMLInputElement }) {
    const text = e.currentTarget.value.trim();
    const graphemes = 'Segmenter' in Intl ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment) : [text];
    emoji = graphemes.at(-1) ?? '';
    e.currentTarget.value = emoji;
  }

  /** There is no way to open the system emoji picker from a web page, so focus the box and say how. */
  function otherEmoji() {
    emojiHint = true;
    emojiInput?.focus();
  }

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const backHref = isProgramme ? '#/programmes' : isNew ? '#/' : `#/w/${id}`;
  const title = isProgramme ? (isNew ? 'New programme' : 'Edit programme') : isNew ? 'New workout' : 'Edit workout';

  function setRepeat(k: 'weekdays' | 'interval') {
    if (schedule.repeat.kind !== k) schedule.repeat = k === 'weekdays' ? { kind: k, days: [1, 3, 5] } : { kind: k, days: 2 };
  }

  function setEnd(k: string) {
    schedule.end = k === 'count' ? { kind: 'count', n: 12 } : k === 'weeks' ? { kind: 'weeks', n: 4 } : k === 'until' ? { kind: 'until', date: schedule.start } : { kind: 'never' };
  }

  /** A one-off workout of a single exercise can go without a name: it takes the exercise's. */
  const soleExercise = $derived(isProgramme ? undefined : flatten(items).length === 1 ? flatten(items)[0].ex.name.trim() : undefined);

  function validate(): string {
    if (!name.trim() && !soleExercise) return isProgramme ? 'Give it a name.' : 'Give it a name, or have just one exercise to name it after.';
    if (!isProgramme) return isISODate(workoutDate) ? '' : 'Pick a date.';
    if (!isISODate(schedule.start)) return 'Pick a start date.';
    const { repeat, end } = schedule;
    if (repeat.kind === 'weekdays' && repeat.days.length === 0) return 'Pick at least one day of the week.';
    if (repeat.kind === 'interval' && !(repeat.days >= 1)) return 'Repeat every 1 day or more.';
    if (end.kind === 'count' && !(end.n >= 1)) return 'The programme needs at least 1 workout.';
    if (end.kind === 'weeks' && !(end.n >= 1)) return 'The programme needs to run for at least 1 week.';
    if (end.kind === 'until' && (!isISODate(end.date) || end.date < schedule.start)) return 'The end date must be on or after the start date.';
    return '';
  }

  function save() {
    error = validate();
    if (error) {
      // Make sure the section with the problem is visible.
      scheduleOpen = true;
      return;
    }
    rememberEmoji(emoji);
    const common = { name: name.trim() || soleExercise || '', emoji: emoji.trim() || '🏋️', items: clone($state.snapshot(items)) as Item[] };
    if (isProgramme) {
      const s = clone($state.snapshot(schedule)) as Schedule;
      if (s.repeat.kind === 'interval') s.repeat.days = Math.round(s.repeat.days);
      if (s.end.kind === 'count' || s.end.kind === 'weeks') s.end.n = Math.round(s.end.n);
      saveProgramme({ ...(source as Programme), ...common, schedule: s, archived });
      go('/programmes');
    } else {
      const ids = new Set(flatten(common.items).map((f) => f.ex.id));
      const kept = Object.fromEntries(Object.entries(clone($state.snapshot(results)) as Record<string, Result>).filter(([k]) => ids.has(k)));
      const was = source as Workout;
      const now = new Date().toISOString();
      const logged = !was.programmeId && workoutDate <= today();
      const w: Workout = {
        ...was,
        ...common,
        date: workoutDate,
        results: kept,
        // Logging after the fact says nothing about when it started, so leave that empty.
        startedAt: was.startedAt,
        completedAt: logged ? (was.completedAt ?? now) : was.completedAt,
      };
      // A one-off workout saved for today or earlier is a log of what was done: every set of every exercise.
      if (logged) for (const { ex, sets } of flatten(w.items)) (w.results[ex.id] ??= { setsDone: 0 }).setsDone = sets;
      saveWorkout(w);
      go(logged ? '/' : `/w/${w.id}`);
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

  function removeAll() {
    const n = db.workouts.filter((w) => w.programmeId === id && isLogged(w)).length;
    const done = n ? ` including ${n} finished one${n === 1 ? '' : 's'}` : '';
    if (!confirm(`Delete "${name}" and all its workouts${done}? This can't be undone.`)) return;
    removeProgrammeAndWorkouts(id);
    go('/programmes');
  }
</script>

<!-- Esc leaves the form without saving, like the ✕ button; an open sheet takes Esc first. -->
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && !document.querySelector('dialog[open]')) location.hash = backHref; }} />

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
      <label class="field icon"><span>Icon</span><input type="text" bind:this={emojiInput} value={emoji} oninput={onEmojiInput} onfocus={(e) => e.currentTarget.select()} autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="emoji-hint" /></label>
      <label class="field grow"><span>Name</span><input type="text" bind:value={name} autocomplete="off" placeholder={isProgramme ? 'Pull day' : soleExercise || 'Evening run'} /></label>
    </div>
    <EmojiPicks bind:value={emoji} options={db.settings.emoji}>
      {#snippet after()}
        <button type="button" class="pick-other" aria-label="Choose another emoji with your keyboard" aria-expanded={emojiHint} onclick={otherEmoji}><Icon name="face" /></button>
      {/snippet}
    </EmojiPicks>

    <p class="muted emoji-hint" id="emoji-hint" hidden={!emojiHint}>
      Type any emoji into the Icon box: use the emoji key on your phone's keyboard, or press Windows + . (Mac: Ctrl + Cmd + Space) on a computer.
    </p>

    {#if isProgramme}
      <Fold title="Schedule" bind:open={scheduleOpen} summary="{describeRepeat(schedule)} · {describeEnd(schedule)}">
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
              <option value="weeks">After a number of weeks</option>
              <option value="until">On a date</option>
              <option value="never">Never</option>
            </select>
          </label>
        </div>
        {#if schedule.end.kind === 'count'}
          <label class="field"><span>Number of workouts (missed ones count)</span><input type="number" inputmode="numeric" min="1" bind:value={schedule.end.n} /></label>
        {:else if schedule.end.kind === 'weeks'}
          <label class="field"><span>Number of weeks</span><input type="number" inputmode="numeric" min="1" bind:value={schedule.end.n} /></label>
        {:else if schedule.end.kind === 'until'}
          <label class="field"><span>Last day</span><input type="date" min={schedule.start} bind:value={schedule.end.date} /></label>
        {/if}
      </div>
      </Fold>
    {:else}
      <label class="field"><span>Date</span><input type="date" bind:value={workoutDate} /></label>
    {/if}

    <Fold title="Exercises" bind:open={exercisesOpen} summary={count === 1 ? '1 exercise' : `${count} exercises`}>
      {#snippet actions()}
        {#if items.length > 1}
          <button type="button" class="icon-btn" aria-label="Move the first exercise to the end" onclick={() => items.push(items.shift()!)}><Icon name="first-to-end" /></button>
          <button type="button" class="icon-btn" aria-label="Move the last exercise to the start" onclick={() => items.unshift(items.pop()!)}><Icon name="last-to-start" /></button>
        {/if}
      {/snippet}
      {#if isProgramme}<ItemsEditor bind:items />{:else}<ItemsEditor bind:items bind:results />{/if}
    </Fold>


    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button type="submit" class="btn primary wide save">Save</button>

    {#if isProgramme && !isNew}
      <p class="muted note">Saving lays out the schedule again from its start date: planned and missed workouts are replaced. Done and partly done ones stay as they are.</p>
      <label class="check"><input type="checkbox" bind:checked={archived} /> Archived (stops planning new workouts)</label>
    {/if}
    {#if !isNew}<button type="button" class="btn danger wide" onclick={remove}>Delete {isProgramme ? 'programme' : 'workout'}</button>{/if}
    {#if isProgramme && !isNew}<button type="button" class="btn danger wide" onclick={removeAll}>Delete programme and all its workouts</button>{/if}
  </form>
{/if}

<style>
  .top { align-items: flex-start; }
  .icon { width: 4.5rem; flex: none; }
  .icon input { text-align: center; font-size: 1.25rem; padding-inline: 0.25rem; }
  .emoji-hint { margin: 0 0.25rem 0.5rem; }
  .card fieldset:last-child, .card .field:last-child { margin-bottom: 0; }
  .save { margin: 1rem 0; }
  .danger + .danger { margin-top: 0.75rem; }
  .note { margin-bottom: 0.75rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin-bottom: 0.75rem; }
  .check input { width: 1.25rem; height: 1.25rem; }
</style>
