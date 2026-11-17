<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { db } from '../lib/state.svelte.ts';
  import { activityAmount, exerciseNames, fmtNum, fmtValues, recordsWeights, searchExercises, unitOf, type SearchEntry, type SearchSort } from '../lib/core.ts';
  import { fmtDayAuto } from '../lib/dates.ts';
  import { formatDuration } from '../lib/duration.ts';
  import { router } from '../lib/router.svelte.ts';

  const FEEL = { easy: 'Easy', hard: 'Hard', failed: 'Failed' } as const;

  let query = $state(untrack(() => router.route.query.get('q') ?? ''));
  let input = $state<HTMLInputElement>();
  let sort = $state<SearchSort>(untrack(() => (router.route.query.get('sort') === 'value' ? 'value' : 'date')));
  const groups = $derived(searchExercises(db, query, sort));
  const names = $derived(exerciseNames(db));
  const total = $derived(groups.reduce((n, g) => n + g.entries.length, 0));

  // Keep the query in the address so Back from a workout returns to the same results.
  $effect(() => {
    const q = query.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (sort !== 'date') params.set('sort', sort);
    const qs = params.toString();
    history.replaceState(history.state, '', qs ? `#/search?${qs}` : '#/search');
  });

  onMount(() => {
    if (!query) input?.focus();
  });

  /** What was recorded, in a few words. */
  function recorded({ ex, sets, result: r }: SearchEntry): string {
    const unit = unitOf(ex);
    const parts: string[] = [];
    if (ex.type === 'activity') parts.push(`${fmtNum(r?.value ?? 0)} ${activityAmount(ex).unit}`);
    else if (recordsWeights(ex) && r?.values?.some((v) => v !== null)) parts.push(`${fmtValues(r.values)} kg`);
    else if (unit && r?.value !== undefined) parts.push(unit === 's' ? formatDuration(r.value) : `${fmtNum(r.value)} ${unit}`);
    if (r?.text) parts.push(r.text);
    if (ex.type !== 'activity') {
      const done = r?.setsDone ?? 0;
      if (done < sets) parts.push(`${done} of ${sets} ${ex.type === 'reps' || ex.type === 'timed' ? 'sets' : 'rounds'}`);
    }
    return parts.join(' · ');
  }

  function plan({ ex, sets }: SearchEntry): string {
    if (ex.type === 'reps') return ex.measure === 'time' ? `${sets} × hold` : `${sets} × ${ex.reps}`;
    if (ex.type === 'timed') return `${sets > 1 ? `${sets} × ` : ''}${ex.reps} × ${formatDuration(ex.workSec)}/${formatDuration(ex.restSec)}`;
    return '';
  }
</script>

<header class="bar">
  <a class="icon-btn" href="#/" aria-label="Back to agenda"><Icon name="back" /></a>
  <h1 tabindex="-1">Exercises</h1>
</header>

<form class="search" role="search" onsubmit={(e) => { e.preventDefault(); input?.blur(); }}>
  <label>
    <span class="sr">Search exercises by name</span>
    <Icon name="search" size={20} />
    <input bind:this={input} type="search" bind:value={query} list="exercise-names" placeholder="Pull-ups" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
  </label>
  <datalist id="exercise-names">{#each names as n}<option value={n}></option>{/each}</datalist>
  {#if query.trim()}
    <fieldset class="sort">
      <legend class="sr">Sort results</legend>
      <div class="chips">
        <label><input type="radio" name="sort" value="date" bind:group={sort} />Newest</label>
        <label><input type="radio" name="sort" value="value" bind:group={sort} />Highest</label>
      </div>
    </fieldset>
  {/if}
</form>

{#if !query.trim()}
  {#if names.length}
    <h2>Done so far</h2>
    <div class="names">
      {#each names as n}<button type="button" class="btn small" onclick={() => (query = n)}>{n}</button>{/each}
    </div>
  {:else}
    <div class="card"><p><strong>Nothing to search yet</strong></p><p class="muted">Exercises show up here once you finish a workout.</p></div>
  {/if}
{:else if groups.length === 0}
  <p class="muted lead" role="status">No finished exercises match "{query.trim()}".</p>
{:else}
  <p class="muted lead" role="status">{total} {total === 1 ? 'time' : 'times'} across {groups.length} {groups.length === 1 ? 'exercise' : 'exercises'}</p>
  {#each groups as g (g.name)}
    <section class="group" aria-label={g.name}>
      <h2>{g.name} <span class="count">{g.entries.length}</span></h2>
      <ol class="entries">
        {#each g.entries as e (e.workout.id + e.ex.id)}
          <li>
            <a class="entry {e.result?.feel ?? ''}" href="#/w/{e.workout.id}">
              <span class="when">
                <span class="date">{fmtDayAuto(e.workout.date)}</span>
                <span class="muted">{e.workout.emoji} {e.workout.name}{plan(e) ? ` · ${plan(e)}` : ''}</span>
              </span>
              <span class="what">
                {recorded(e)}
                {#if e.result?.feel}<span class="feel">{FEEL[e.result.feel]}</span>{/if}
              </span>
            </a>
          </li>
        {/each}
      </ol>
    </section>
  {/each}
{/if}

<style>
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .search { position: sticky; top: 3.5rem; z-index: 4; background: var(--bg); padding-bottom: 0.5rem; }
  .search label { position: relative; display: block; color: var(--muted); }
  .search label > :global(svg) { position: absolute; left: 0.875rem; top: 50%; translate: 0 -50%; pointer-events: none; }
  .search input { padding-left: 2.75rem; border-radius: 99px; }
  .lead { margin: 0.25rem 0.25rem 0.5rem; }
  .sort { margin: 0.5rem 0 0; }
  .sort .chips label { min-height: 2.25rem; padding: 0 0.875rem; font-size: 0.875rem; }
  .names { display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .group h2 { display: flex; align-items: center; gap: 0.5rem; color: var(--text); font-size: 1rem; }
  .count { font-size: 0.75rem; font-weight: 600; color: var(--muted); background: var(--raise); border-radius: 99px; padding: 0.0625rem 0.5rem; }
  .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.375rem; }
  .entry { display: flex; align-items: center; gap: 0.75rem; padding: 0.625rem 0.75rem; border-radius: 14px; background: var(--card); border-left: 4px solid transparent; }
  .entry.easy { border-left-color: var(--ok); }
  .entry.hard { border-left-color: var(--warn); }
  .entry.failed { border-left-color: var(--bad); }
  .when { flex: 1; min-width: 0; display: grid; }
  .date { font-weight: 600; }
  .when .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what { flex: none; max-width: 50%; display: grid; justify-items: end; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .feel { font-size: 0.75rem; font-weight: 600; color: var(--muted); }
  .entry.easy .feel { color: var(--ok); }
  .entry.hard .feel { color: var(--warn); }
  .entry.failed .feel { color: var(--bad); }
</style>
