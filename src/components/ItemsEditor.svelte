<script lang="ts">
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { clone, describe, uid } from '../lib/core.ts';
  import type { Exercise, Item, Superset } from '../lib/types.ts';

  let { items = $bindable() }: { items: Item[] } = $props();

  type Kind = Exercise['type'];
  const KINDS: { id: Kind; label: string; hint: string }[] = [
    { id: 'reps', label: 'Reps', hint: 'Sets of reps or holds. Can record a weight or a hold time.' },
    { id: 'timed', label: 'Timed', hint: 'Intervals of work and rest, run by the timer.' },
    { id: 'activity', label: 'Activity', hint: 'Anything else: a warm-up, a run, 30 jumping jacks.' },
  ];

  function blank(type: Kind, base: { id: string; name: string; description?: string; restAfter?: number }): Exercise {
    if (type === 'reps') return { ...base, type, sets: 3, reps: 10, measure: 'weight' };
    if (type === 'timed') return { ...base, type, sets: 3, workSec: 30, restSec: 30, trackWeight: false };
    return { ...base, type, measure: 'time', target: 10 };
  }

  let open = $state(false);
  let draft = $state<Exercise>(blank('reps', { id: uid(), name: '' }));
  let inSuperset = $state(false);
  let isNew = $state(true);
  let error = $state('');
  // Where the draft goes when the sheet is confirmed.
  let list: (Item | Exercise)[] = items;
  let index = -1;

  function add(to: (Item | Exercise)[], superset: boolean) {
    list = to;
    index = -1;
    inSuperset = superset;
    isNew = true;
    error = '';
    draft = blank('reps', { id: uid(), name: '' });
    open = true;
  }

  function edit(from: (Item | Exercise)[], i: number, superset: boolean) {
    list = from;
    index = i;
    inSuperset = superset;
    isNew = false;
    error = '';
    draft = clone($state.snapshot(from[i])) as Exercise;
    open = true;
  }

  const int = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : fallback);
  const optional = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : undefined);

  function apply() {
    draft.name = draft.name.trim();
    if (!draft.name) return (error = 'Give the exercise a name.');
    draft.description = draft.description?.trim() || undefined;
    draft.restAfter = inSuperset ? undefined : optional(draft.restAfter);
    if (draft.type === 'reps') {
      draft.sets = inSuperset ? 1 : int(draft.sets, 1, 3);
      draft.reps = int(draft.reps, 1, 1);
      draft.restBetweenSets = inSuperset ? undefined : optional(draft.restBetweenSets);
    } else if (draft.type === 'timed') {
      draft.sets = inSuperset ? 1 : int(draft.sets, 1, 3);
      draft.workSec = int(draft.workSec, 1, 30);
      draft.restSec = int(draft.restSec, 0, 0);
    } else {
      draft.target = typeof draft.target === 'number' && draft.target > 0 ? draft.target : 1;
    }
    const value = clone($state.snapshot(draft)) as Exercise;
    if (index < 0) list.push(value);
    else list[index] = value;
    open = false;
  }

  function remove() {
    if (index >= 0) list.splice(index, 1);
    open = false;
  }

  function move(arr: (Item | Exercise)[], i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  function addSuperset() {
    items.push({ id: uid(), type: 'superset', rounds: 3, items: [], restBetweenRounds: 60 });
  }

  function cleanSuperset(s: Superset) {
    s.rounds = int(s.rounds, 1, 3);
    s.restBetweenRounds = optional(s.restBetweenRounds);
    s.restAfter = optional(s.restAfter);
  }
</script>

{#snippet row(arr: (Item | Exercise)[], i: number, ex: Exercise, superset: boolean)}
  <div class="item">
    <button type="button" class="main" onclick={() => edit(arr, i, superset)}>
      <strong>{ex.name}</strong>
      <span class="muted">{describe(ex, superset)}{ex.restAfter ? ` · then rest ${ex.restAfter} s` : ''}</span>
    </button>
    <button type="button" class="icon-btn" aria-label="Move {ex.name} up" aria-disabled={i === 0} onclick={() => move(arr, i, -1)}><Icon name="up" /></button>
    <button type="button" class="icon-btn" aria-label="Move {ex.name} down" aria-disabled={i === arr.length - 1} onclick={() => move(arr, i, 1)}><Icon name="down" /></button>
  </div>
{/snippet}

{#each items as item, i (item.id)}
  {#if item.type === 'superset'}
    <fieldset class="superset">
      <legend><Icon name="repeat" size={16} /> Superset</legend>
      <div class="cols">
        <label class="field"><span>Rounds</span><input type="number" inputmode="numeric" min="1" bind:value={item.rounds} onchange={() => cleanSuperset(item)} /></label>
        <label class="field"><span>Rest between rounds, s</span><input type="number" inputmode="numeric" min="0" bind:value={item.restBetweenRounds} onchange={() => cleanSuperset(item)} /></label>
        <label class="field"><span>Rest after, s</span><input type="number" inputmode="numeric" min="0" bind:value={item.restAfter} onchange={() => cleanSuperset(item)} /></label>
      </div>
      {#each item.items as ex, j (ex.id)}{@render row(item.items, j, ex, true)}{/each}
      <div class="row">
        <button type="button" class="btn small grow" onclick={() => add(item.items, true)}><Icon name="plus" size={18} /> Exercise</button>
        <button type="button" class="icon-btn" aria-label="Move superset up" aria-disabled={i === 0} onclick={() => move(items, i, -1)}><Icon name="up" /></button>
        <button type="button" class="icon-btn" aria-label="Move superset down" aria-disabled={i === items.length - 1} onclick={() => move(items, i, 1)}><Icon name="down" /></button>
        <button type="button" class="icon-btn" aria-label="Remove superset" onclick={() => items.splice(i, 1)}><Icon name="trash" /></button>
      </div>
    </fieldset>
  {:else}
    {@render row(items, i, item, false)}
  {/if}
{:else}
  <p class="muted none">No exercises yet.</p>
{/each}

<div class="row">
  <button type="button" class="btn grow" onclick={() => add(items, false)}><Icon name="plus" size={18} /> Exercise</button>
  <button type="button" class="btn grow" onclick={addSuperset}><Icon name="plus" size={18} /> Superset</button>
</div>

<Sheet bind:open label={isNew ? 'Add exercise' : 'Edit exercise'}>
  <form onsubmit={(e) => { e.preventDefault(); apply(); }}>
    <label class="field"><span>Name</span><input type="text" bind:value={draft.name} autocomplete="off" enterkeyhint="done" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <fieldset>
      <legend>Type</legend>
      <div class="chips">
        {#each KINDS as k}
          <label><input type="radio" name="kind" value={k.id} checked={draft.type === k.id} onchange={() => (draft = blank(k.id, { id: draft.id, name: draft.name, description: draft.description, restAfter: draft.restAfter }))} />{k.label}</label>
        {/each}
      </div>
      <p class="muted hint">{KINDS.find((k) => k.id === draft.type)?.hint}</p>
    </fieldset>

    {#if draft.type === 'reps'}
      <div class="cols">
        {#if !inSuperset}<label class="field"><span>Sets</span><input type="number" inputmode="numeric" min="1" bind:value={draft.sets} /></label>{/if}
        <label class="field"><span>Reps per set</span><input type="number" inputmode="numeric" min="1" bind:value={draft.reps} /></label>
      </div>
      <fieldset>
        <legend>Record each workout</legend>
        <div class="chips">
          <label><input type="radio" name="measure" value="weight" bind:group={draft.measure} />Weight</label>
          <label><input type="radio" name="measure" value="time" bind:group={draft.measure} />Hold time</label>
          <label><input type="radio" name="measure" value="none" bind:group={draft.measure} />Nothing</label>
        </div>
      </fieldset>
      {#if !inSuperset}
        <label class="field"><span>Rest between sets, s (optional)</span><input type="number" inputmode="numeric" min="0" bind:value={draft.restBetweenSets} /></label>
      {/if}
    {:else if draft.type === 'timed'}
      <div class="cols">
        {#if !inSuperset}<label class="field"><span>Sets</span><input type="number" inputmode="numeric" min="1" bind:value={draft.sets} /></label>{/if}
        <label class="field"><span>Work, s</span><input type="number" inputmode="numeric" min="1" bind:value={draft.workSec} /></label>
        <label class="field"><span>Rest, s</span><input type="number" inputmode="numeric" min="0" bind:value={draft.restSec} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={draft.trackWeight} /> Record a weight</label>
    {:else}
      <fieldset>
        <legend>Measured in</legend>
        <div class="chips">
          <label><input type="radio" name="ameasure" value="time" bind:group={draft.measure} />Minutes</label>
          <label><input type="radio" name="ameasure" value="count" bind:group={draft.measure} />Count</label>
        </div>
      </fieldset>
      <label class="field"><span>{draft.measure === 'time' ? 'Minutes' : 'How many'}</span><input type="number" inputmode="decimal" min="0" step="any" bind:value={draft.target} /></label>
    {/if}

    {#if !inSuperset}
      <label class="field"><span>Rest after the exercise, s (optional)</span><input type="number" inputmode="numeric" min="0" bind:value={draft.restAfter} /></label>
    {/if}
    <label class="field"><span>Notes (optional)</span><input type="text" bind:value={draft.description} autocomplete="off" /></label>

    <div class="row">
      {#if !isNew}<button type="button" class="btn danger" onclick={remove}>Remove</button>{/if}
      <button type="submit" class="btn primary grow">{isNew ? 'Add' : 'Done'}</button>
    </div>
  </form>
</Sheet>

<style>
  .item { display: flex; align-items: center; background: var(--card); border-radius: var(--radius); margin-bottom: 0.5rem; padding-right: 0.25rem; }
  .main { flex: 1; min-width: 0; display: grid; gap: 0.125rem; text-align: left; padding: 0.75rem; background: none; border: none; color: inherit; font: inherit; cursor: pointer; border-radius: var(--radius); }
  .superset { border: 2px dashed #7f77dd; border-radius: 20px; padding: 0.25rem 0.625rem 0.625rem; margin-bottom: 0.5rem; }
  .superset legend { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--accent); padding: 0 0.375rem; margin: 0; }
  .superset .item { background: var(--card); }
  .none { padding: 0.5rem 0.25rem 0.75rem; }
  .hint { margin-top: 0.375rem; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin-bottom: 0.75rem; }
  .check input { width: 1.25rem; height: 1.25rem; }
</style>
