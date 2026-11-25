<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { db, getProgramme } from '../lib/state.svelte.ts';
  import { describePlan, isLogged, flatten, statusOf } from '../lib/core.ts';
  import { fmtRecorded, recordUnits } from '../lib/record.ts';
  import { fmtShort, today as todayISO } from '../lib/dates.ts';
  import type { Exercise, Item, Workout } from '../lib/types.ts';

  let { id }: { id: string } = $props();
  const today = todayISO();
  const programme = $derived(getProgramme(id));
  const mine = $derived(db.workouts.filter((w) => w.programmeId === id));
  const done = $derived(mine.filter(isLogged).sort((a, b) => a.date.localeCompare(b.date)));
  const missedList = $derived(mine.filter((w) => statusOf(w, today) === 'missed'));
  const missed = $derived(missedList.length);
  // Done and missed together, newest first, so gaps in the programme show where they happened.
  const columns = $derived([...done, ...missedList].sort((a, b) => b.date.localeCompare(a.date) || (b.completedAt ?? '').localeCompare(a.completedAt ?? '')));

  type Row = { ex: Exercise; inSuperset: boolean };
  // One row per exercise: the programme's current ones first, then any that only exist in history.
  const rows = $derived.by(() => {
    const seen = new Map<string, Row>();
    const add = (items: Item[]) => {
      for (const { ex, supersetId } of flatten(items)) if (!seen.has(ex.id)) seen.set(ex.id, { ex, inSuperset: !!supersetId });
    };
    add(programme?.items ?? []);
    for (const w of done) add(w.items);
    return [...seen.values()];
  });

  let scroller = $state<HTMLDivElement>();

  // Flipped: workouts down the side and exercises along the top. Remembered on this device.
  const FLIP_KEY = 'workouts:history-flipped';
  let flipped = $state(readFlip());
  function readFlip(): boolean {
    try { return localStorage.getItem(FLIP_KEY) === '1'; } catch { return false; }
  }
  function flip() {
    flipped = !flipped;
    try { localStorage.setItem(FLIP_KEY, flipped ? '1' : '0'); } catch { /* not stored: fine */ }
  }
</script>

<header class="bar">
  <a class="icon-btn" href="#/programmes" aria-label="Back to programmes"><Icon name="back" /></a>
  <h1 tabindex="-1">{programme?.emoji} {programme?.name ?? 'Programme'}</h1>
</header>

<p class="muted lead">{done.length} done · {missed} missed</p>

{#if columns.length}
  <!-- A scrollable region has to be focusable so it can be scrolled from the keyboard. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroller" bind:this={scroller} tabindex="0" role="region" aria-label="Done and missed workouts">
    {#snippet corner()}
      <th scope="col" class="corner">
        <button class="icon-btn flip" aria-pressed={flipped} aria-label="Flip the table: {flipped ? 'workouts along the top' : 'workouts down the side'}" onclick={flip}><Icon name="transpose" size={24} /></button>
      </th>
    {/snippet}
    {#snippet dateHead(w: Workout, scope: 'col' | 'row')}
      <th {scope} class="date-head" class:missed-col={!isLogged(w)} class:today={w.date === today}><a href="#/w/{w.id}">{fmtShort(w.date)}</a>{#if !isLogged(w)}<span class="sr"> (missed)</span>{/if}</th>
    {/snippet}
    {#snippet nameHead(row: Row, scope: 'col' | 'row')}
      {@const reps = describePlan(row.ex, row.inSuperset).replace(/^Activity$/, '')}
      <th {scope} class="name-head">{row.ex.name}<span class="muted plan">{[reps, recordUnits(row.ex.record)].filter(Boolean).join('; ')}</span></th>
    {/snippet}
    {#snippet cell(w: Workout, { ex }: Row)}
      {#if !isLogged(w)}
        <td class="missed-cell"><span class="sr">Missed</span></td>
      {:else}
        {@const present = flatten(w.items).find((f) => f.ex.id === ex.id)}
        {@const r = w.results[ex.id]}
        <td class={r?.feel ?? ''}>
          {#if r?.dumbbells}<span class="db" title="Dumbbells: weight per dumbbell"><Icon name="dumbbell" size={14} /></span><span class="sr">Dumbbells, </span>{/if}
          {#if !present}
            <span class="muted" aria-label="Not in this workout">·</span>
          {:else if fmtRecorded(present.ex, r)}
            <!-- Units only when the cell mixes kinds; one kind's unit is in the row's heading. -->
            {@const text = fmtRecorded(present.ex, r, new Set(present.ex.record).size > 1)}
            <span class="text" title={text}>{text}</span>
          {:else if present.ex.type === 'activity'}
            <span class="muted">–</span>
          {:else if (r?.setsDone ?? 0) >= present.sets}
            <Icon name="check" size={16} /><span class="sr">Done</span>
          {:else}
            <span class="muted">{r?.setsDone ?? 0}/{present.sets}</span>
          {/if}
          {#if r?.feel}<span class="sr">, felt {r.feel}</span>{/if}
        </td>
      {/if}
    {/snippet}

    <table class:flipped>
      {#if flipped}
        <!-- Exercises along the top, one row per workout. -->
        <thead><tr>{@render corner()}{#each rows as row (row.ex.id)}{@render nameHead(row, 'col')}{/each}</tr></thead>
        <tbody>
          {#each columns as w (w.id)}
            <tr>{@render dateHead(w, 'row')}{#each rows as row (row.ex.id)}{@render cell(w, row)}{/each}</tr>
          {/each}
        </tbody>
      {:else}
        <thead><tr>{@render corner()}{#each columns as w (w.id)}{@render dateHead(w, 'col')}{/each}</tr></thead>
        <tbody>
          {#each rows as row (row.ex.id)}
            <tr>{@render nameHead(row, 'row')}{#each columns as w (w.id)}{@render cell(w, row)}{/each}</tr>
          {/each}
        </tbody>
      {/if}
    </table>
  </div>
  <p class="legend muted"><span class="key missed-key">Missed</span><span class="key easy">Easy</span><span class="key hard">Hard</span><span class="key failed">Not finished</span></p>
{:else}
  <div class="card"><p><strong>No finished workouts yet</strong></p><p class="muted">Each one you finish becomes a column here.</p></div>
{/if}

{#if programme?.description}<p class="about">{programme.description}</p>{/if}

<style>
  .lead { margin: 0 0.25rem 0.75rem; }
  .scroller { overflow: auto; max-width: 100%; border-radius: var(--radius); }
  table { border-collapse: separate; border-spacing: 3px; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
  th, td { padding: 0.5rem 0.625rem; text-align: center; white-space: nowrap; border-radius: 8px; font-weight: 400; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--bg); color: var(--muted); }
  th a { text-decoration: underline; text-underline-offset: 3px; }
  /* The flip button sits in the empty top-left cell. */
  th.corner { padding: 0; vertical-align: middle; }
  .flip { width: 2.75rem; height: 2.75rem; min-height: 0; color: var(--muted); }
  .flip[aria-pressed='true'] { color: var(--accent); }
  /* Flipped: exercise names along the top wrap within a column; dates down the side don't. */
  .flipped thead th.name-head { white-space: normal; min-width: 5rem; max-width: 8rem; text-align: left; vertical-align: bottom; color: var(--text); }
  .flipped .plan { white-space: normal; color: var(--muted); }
  .flipped tbody th.date-head { white-space: nowrap; }
  /* Row headers stay put while the workouts scroll sideways. */
  /* The exercise names are plain labels: no rounded cell, just the page colour so values scroll under them. */
  tbody th, thead th:first-child { position: sticky; left: 0; background: var(--bg); border-radius: 0; text-align: left; max-width: 9rem; white-space: normal; z-index: 2; }
  td { background: var(--card); min-width: 3.75rem; }
  /* Missed workouts: a red slash through each cell, as in the agenda; the date stays plain. */
  /* Today's workout stands out among the dates. */
  th.today a { color: var(--accent-ink); background: var(--accent); border-radius: 8px; padding: 0.125rem 0.375rem; text-decoration: none; }
  /* Sets and reps, then the unit, on their own line under the name: "3 × 5; kg". */
  .plan { display: block; white-space: nowrap; font-size: 0.8125rem; }
  td.missed-cell { background: linear-gradient(to top right, transparent calc(50% - 1px), var(--bad-line) calc(50% - 1px), var(--bad-line) calc(50% + 1px), transparent calc(50% + 1px)), var(--card); opacity: 0.6; }
  .text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; max-width: 9rem; white-space: normal; text-align: left; }
  /* How it felt: a small dot in the cell's corner, so the values stay the focus. */
  td.easy, td.hard, td.failed { position: relative; }
  td.easy::after, td.hard::after, td.failed::after, .key::before { content: ''; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--feel); }
  td.easy::after, td.hard::after, td.failed::after { position: absolute; top: 0.3125rem; right: 0.3125rem; }
  /* Not finished stands out: a red cross instead of a dot. */
  td.failed::after, .key.failed::before { content: '✕'; width: auto; height: auto; border-radius: 0; background: none; color: var(--bad); font-size: 0.75rem; font-weight: 800; line-height: 1; }
  td.failed::after { top: 0.25rem; }
  .easy { --feel: var(--ok); }
  .hard { --feel: var(--warn); }
  .failed { --feel: var(--bad); }
  .db { display: inline-flex; vertical-align: -0.125em; margin-inline-end: 0.125rem; opacity: 0.8; }
  td :global(.muted) { font-size: inherit; }
  /* The programme's description, under the table. */
  .about { margin: 1.25rem 0.25rem 0; white-space: pre-line; overflow-wrap: anywhere; color: var(--muted); }
  .legend { display: flex; flex-wrap: wrap; gap: 0.25rem 0.875rem; margin-top: 0.75rem; }
  .key { display: inline-flex; align-items: center; gap: 0.375rem; }
  .key.missed-key { color: var(--bad); }
  .key.missed-key::before { content: '╱'; width: auto; height: auto; border-radius: 0; background: none; font-weight: 600; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
