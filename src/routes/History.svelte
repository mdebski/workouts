<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { db, getProgramme } from '../lib/state.svelte.ts';
  import { flatten, fmtNum, statusOf, unitOf, valueOf } from '../lib/core.ts';
  import { fmtShort, today as todayISO } from '../lib/dates.ts';
  import type { Exercise } from '../lib/types.ts';

  let { id }: { id: string } = $props();
  const today = todayISO();
  const programme = $derived(getProgramme(id));
  const mine = $derived(db.workouts.filter((w) => w.programmeId === id));
  const done = $derived(mine.filter((w) => w.status === 'done').sort((a, b) => a.date.localeCompare(b.date)));
  const missed = $derived(mine.filter((w) => statusOf(w, today) === 'missed').length);

  // One row per exercise: the programme's current ones first, then any that only exist in history.
  const rows = $derived.by(() => {
    const seen = new Map<string, Exercise>();
    for (const { ex } of flatten(programme?.items ?? [])) seen.set(ex.id, ex);
    for (const w of done) for (const { ex } of flatten(w.items)) if (!seen.has(ex.id)) seen.set(ex.id, ex);
    return [...seen.values()];
  });

  let scroller = $state<HTMLDivElement>();
  onMount(() => scroller?.scrollTo({ left: scroller.scrollWidth }));
</script>

<header class="bar">
  <a class="icon-btn" href="#/programmes" aria-label="Back to programmes"><Icon name="back" /></a>
  <h1 tabindex="-1">{programme?.emoji} {programme?.name ?? 'Programme'}</h1>
</header>

<p class="muted lead">{done.length} done · {missed} missed</p>

{#if done.length}
  <!-- A scrollable region has to be focusable so it can be scrolled from the keyboard. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroller" bind:this={scroller} tabindex="0" role="region" aria-label="Completed workouts">
    <table>
      <thead>
        <tr>
          <th scope="col"><span class="sr">Exercise</span></th>
          {#each done as w (w.id)}<th scope="col"><a href="#/w/{w.id}">{fmtShort(w.date)}</a></th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as ex (ex.id)}
          {@const unit = unitOf(ex)}
          <tr>
            <th scope="row">{ex.name}{#if unit && unit !== '×'}{' '}<span class="muted">{unit}</span>{/if}</th>
            {#each done as w (w.id)}
              {@const present = flatten(w.items).find((f) => f.ex.id === ex.id)}
              {@const r = w.results[ex.id]}
              <td class={r?.feel ?? ''}>
                {#if !present}
                  <span class="muted" aria-label="Not in this workout">·</span>
                {:else if unit && valueOf(w, present.ex) !== undefined}
                  {fmtNum(valueOf(w, present.ex)!)}
                {:else if (r?.setsDone ?? 0) >= present.sets}
                  <Icon name="check" size={16} /><span class="sr">Done</span>
                {:else}
                  <span class="muted">{r?.setsDone ?? 0}/{present.sets}</span>
                {/if}
                {#if r?.feel}<span class="sr">, felt {r.feel}</span>{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="legend muted"><span class="key easy">Easy</span><span class="key hard">Hard</span><span class="key failed">Failed</span></p>
{:else}
  <div class="card"><p><strong>No finished workouts yet</strong></p><p class="muted">Each one you finish becomes a column here.</p></div>
{/if}

<style>
  .lead { margin: 0 0.25rem 0.75rem; }
  .scroller { overflow: auto; max-width: 100%; border-radius: var(--radius); }
  table { border-collapse: separate; border-spacing: 3px; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
  th, td { padding: 0.5rem 0.625rem; text-align: center; white-space: nowrap; border-radius: 8px; font-weight: 400; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--bg); color: var(--muted); }
  thead th a { text-decoration: underline; text-underline-offset: 3px; }
  /* Row headers stay put while the workouts scroll sideways. */
  tbody th, thead th:first-child { position: sticky; left: 0; background: var(--bg); text-align: left; max-width: 9rem; white-space: normal; z-index: 2; }
  td { background: var(--card); min-width: 3.75rem; }
  td.easy, .key.easy { background: var(--ok); color: var(--ok-ink); }
  td.hard, .key.hard { background: var(--warn); color: var(--warn-ink); }
  td.failed, .key.failed { background: var(--bad); color: var(--bad-ink); }
  td :global(.muted) { font-size: inherit; }
  .legend { display: flex; gap: 0.375rem; margin-top: 0.75rem; }
  .key { padding: 0.125rem 0.625rem; border-radius: 99px; font-weight: 600; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
