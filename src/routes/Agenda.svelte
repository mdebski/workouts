<script lang="ts" module>
  // How far the list reaches, kept while the app is open so coming back restores the same list.
  let keptPast = 14;
  let keptFuture = 42;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { scrollMemory } from '../lib/router.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import MainTabs from '../components/MainTabs.svelte';
  import AddButton from '../components/AddButton.svelte';
  import { db } from '../lib/state.svelte.ts';
  import { flatten, fmtRecorded, hasProgress, slotInfo, statusOf } from '../lib/core.ts';
  import { addDays, fmtMonth, fmtWeekday, today as todayISO, weekday } from '../lib/dates.ts';
  import type { Workout } from '../lib/types.ts';

  const today = todayISO();
  let pastDays = $state(keptPast);
  let futureDays = $state(keptFuture);
  $effect(() => {
    keptPast = pastDays;
    keptFuture = futureDays;
  });

  const byDate = $derived.by(() => {
    const map = new Map<string, Workout[]>();
    for (const w of db.workouts) map.set(w.date, [...(map.get(w.date) ?? []), w]);
    return map;
  });

  const days = $derived(Array.from({ length: pastDays + futureDays + 1 }, (_, i) => addDays(today, i - pastDays)));
  const hasEarlier = $derived(db.workouts.some((w) => w.date < days[0]));

  function sub(w: Workout): string {
    const status = statusOf(w, today);
    const slot = slotInfo(db, w);
    const parts: string[] = [];
    if (status === 'missed') parts.push('Missed');
    if (status === 'partial') parts.push('Partly done');
    // A single exercise: show what was recorded, e.g. "42.5 kg", "5.4 km" or "1h 15min".
    const flat = flatten(w.items);
    if (flat.length === 1) {
      const recorded = fmtRecorded(flat[0].ex, w.results[flat[0].ex.id]);
      const r = w.results[flat[0].ex.id];
      if (recorded) parts.push(recorded);
      // Nothing recorded but some sets ticked, and not finished: how far it got, e.g. "3/6 sets".
      else if (status !== 'done' && flat[0].sets > 1 && (r?.setsDone ?? 0) > 0) parts.push(`${r!.setsDone}/${flat[0].sets} sets`);
      else if (!slot) parts.push(flat[0].ex.type === 'activity' ? 'Activity' : 'One-off');
      return parts.join(' · ');
    }
    if (!slot) parts.push('One-off');
    return parts.join(' · ');
  }

  // Back from a workout (or another screen): the same place as before. First time: today.
  onMount(() => {
    const y = scrollMemory.get('agenda');
    if (y !== undefined) scrollTo(0, y);
    else document.getElementById('today')?.scrollIntoView({ block: 'start' });
  });
</script>

<header class="bar main">
  <MainTabs active="workouts" />
  <AddButton />
  <a class="icon-btn" href="#/search" aria-label="Search exercises"><Icon name="search" /></a>
  <a class="icon-btn" href="#/settings" aria-label="Settings"><Icon name="settings" /></a>
</header>

{#if hasEarlier}
  <button class="btn small wide more" onclick={() => (pastDays += 28)}>Show earlier</button>
{/if}

<ol class="days">
  {#each days as date, i (date)}
    {@const list = byDate.get(date) ?? []}
    {#if i === 0 || date.endsWith('-01')}
      <li class="month" aria-hidden="true">{fmtMonth(date)}</li>
    {/if}
    <li class="day" class:is-today={date === today} class:week-start={i > 0 && weekday(date) === 1} id={date === today ? 'today' : undefined}>
      <div class="date">
        <span>{date === today ? 'Today' : fmtWeekday(date)}</span>
        <b>{Number(date.slice(8))}</b>
      </div>
      <div class="list">
        {#each list as w (w.id)}
          {@const status = statusOf(w, today)}
          <a class="w {status}" class:started={status !== 'done' && hasProgress(w)} href="#/w/{w.id}">
            <span class="emoji" aria-hidden="true">{w.emoji}</span>
            <span class="text">
              <span class="name">{w.name}</span>
              {#if sub(w)}<span class="muted">{sub(w)}</span>{/if}
            </span>
            {#if status === 'done'}<span class="mark"><Icon name="check" size={14} /><span class="sr">Done</span></span>{/if}
            {#if status === 'today'}<span class="mark"><Icon name="play" size={12} /></span>{/if}
          </a>
        {:else}
          <p class="empty">Nothing planned</p>
        {/each}
      </div>
    </li>
  {/each}
</ol>

<button class="btn small wide more" onclick={() => (futureDays += 28)}>Show later</button>


<style>
  .more { margin: 0.5rem 0; }
  .days { list-style: none; margin: 0; padding: 0; }
  .month { position: sticky; top: 3.5rem; z-index: 2; background: var(--bg); padding: 0.5rem 0.25rem; font-size: 0.8125rem; font-weight: 600; color: var(--muted); }
  .day { display: flex; gap: 0.625rem; margin-bottom: 0.5rem; scroll-margin-top: 6rem; }
  /* A thin line above each Monday separates the weeks. */
  .day.week-start { border-top: 1px solid var(--line); padding-top: 0.5rem; }
  .date { width: 2.75rem; flex: none; text-align: center; font-size: 0.75rem; color: var(--muted); padding-top: 0.375rem; }
  .date b { display: block; font-size: 1.125rem; font-weight: 650; color: var(--text); border-radius: 10px; }
  /* Today's row: a faint tint behind the date and its workouts, with some room above and below. */
  .day.is-today { background: var(--today-tint); border: none; border-radius: var(--radius); padding: 0.375rem; margin: 0.75rem -0.375rem; }
  .is-today .date { color: var(--accent); }
  .is-today .date b { background: var(--accent); color: var(--accent-ink); }
  /* Two workouts side by side; a day with one leaves the other half empty. */
  .list { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.375rem; align-content: start; }
  .empty { grid-column: 1 / -1; color: var(--muted); font-size: 0.8125rem; padding: 0.625rem 0.25rem; }

  .w {
    position: relative; overflow: hidden;
    display: flex; align-items: center; gap: 0.5rem;
    min-height: 3.25rem; padding: 0.375rem 0.5rem;
    border: 2px solid transparent; border-radius: var(--radius);
    background: var(--card);
  }
  .text { flex: 1; min-width: 0; display: grid; }
  .name { font-weight: 600; font-size: 0.875rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
  .text .muted { font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .w .emoji { width: 1.75rem; height: 1.75rem; font-size: 1rem; border-radius: 9px; }
  .mark { position: absolute; top: 0.25rem; right: 0.25rem; }
  .done, .today { padding-right: 1.125rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

  .done { border-color: var(--ok-line); }
  .done .mark { color: var(--ok); }
  .planned { background: transparent; border: 2px dashed var(--line); }
  /* Today, not started yet: a plain solid grey border; the row's tint marks the day. */
  .today { border-color: var(--line); }
  /* Started but not finished, on any day (a set ticked or a value entered): the done colour, dotted. */
  .partial, .started { border: 2px dotted var(--ok-line); }
  /* Missed: red border and a slash across the card. */
  .missed {
    border-color: var(--bad-line);
    background: linear-gradient(to top right, transparent calc(50% - 1px), var(--bad-line) calc(50% - 1px), var(--bad-line) calc(50% + 1px), transparent calc(50% + 1px)), var(--card);
  }
  .missed .name { color: var(--muted); }
  .missed .emoji { filter: grayscale(1); }
</style>
