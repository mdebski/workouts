<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { db } from '../lib/state.svelte.ts';
  import { durationMin, slotInfo, statusOf } from '../lib/core.ts';
  import { addDays, fmtMonth, fmtWeekday, today as todayISO } from '../lib/dates.ts';
  import type { Workout } from '../lib/types.ts';

  const today = todayISO();
  let pastDays = $state(14);
  let futureDays = $state(42);

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
    if (slot) parts.push(slot.total ? `${slot.index} of ${slot.total}` : `No. ${slot.index}`);
    else parts.push('One-off');
    const mins = durationMin(w);
    if (mins) parts.push(`${mins} min`);
    if (status === 'today') parts.push('tap to start');
    return parts.join(' · ');
  }

  onMount(() => document.getElementById('today')?.scrollIntoView({ block: 'start' }));
</script>

<header class="bar">
  <h1 tabindex="-1">Workouts</h1>
  <a class="icon-btn add" href="#/w/new/edit?date={today}" aria-label="Add a one-off workout"><Icon name="plus" /></a>
  <a class="icon-btn" href="#/programmes" aria-label="Programmes"><Icon name="list" /></a>
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
    <li class="day" class:is-today={date === today} id={date === today ? 'today' : undefined}>
      <div class="date">
        <span>{date === today ? 'Today' : fmtWeekday(date)}</span>
        <b>{Number(date.slice(8))}</b>
      </div>
      <div class="list">
        {#each list as w (w.id)}
          {@const status = statusOf(w, today)}
          <a class="w {status}" href="#/w/{w.id}">
            <span class="emoji" aria-hidden="true">{w.emoji}</span>
            <span class="text">
              <span class="name">{w.name}</span>
              <span class="muted">{sub(w)}</span>
            </span>
            {#if status === 'done'}<span class="mark"><Icon name="check" size={20} /><span class="sr">Done</span></span>{/if}
            {#if status === 'today'}<span class="mark"><Icon name="play" size={18} /></span>{/if}
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
  .add { color: var(--accent); }
  .more { margin: 0.5rem 0; }
  .days { list-style: none; margin: 0; padding: 0; }
  .month { position: sticky; top: 3.5rem; z-index: 2; background: var(--bg); padding: 0.5rem 0.25rem; font-size: 0.8125rem; font-weight: 600; color: var(--muted); }
  .day { display: flex; gap: 0.625rem; margin-bottom: 0.5rem; scroll-margin-top: 6rem; }
  .date { width: 2.75rem; flex: none; text-align: center; font-size: 0.75rem; color: var(--muted); padding-top: 0.375rem; }
  .date b { display: block; font-size: 1.125rem; font-weight: 650; color: var(--text); border-radius: 10px; }
  .is-today .date { color: var(--accent); }
  .is-today .date b { background: var(--accent); color: var(--accent-ink); }
  .list { flex: 1; min-width: 0; }
  .empty { color: var(--muted); font-size: 0.8125rem; padding: 0.75rem 0.25rem; }

  .w {
    display: flex; align-items: center; gap: 0.625rem;
    padding: 0.5rem 0.75rem; margin-bottom: 0.375rem;
    border: 2px solid transparent; border-radius: var(--radius);
    background: var(--card);
  }
  .text { flex: 1; min-width: 0; display: grid; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { display: grid; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

  .done { border-color: var(--ok-line); }
  .done .mark { color: var(--ok); }
  .planned { background: transparent; border: 2px dashed var(--line); }
  .today { background: var(--accent-deep); }
  .today .muted { color: #dcd9f8; }
  .today .emoji { background: #534ab7; }
  /* Missed: red border and a slash across the card. */
  .missed {
    border-color: var(--bad-line);
    background: linear-gradient(to top right, transparent calc(50% - 1px), var(--bad-line) calc(50% - 1px), var(--bad-line) calc(50% + 1px), transparent calc(50% + 1px)), var(--card);
  }
  .missed .name { color: var(--muted); }
  .missed .emoji { filter: grayscale(1); }
</style>
