<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import DurationInput from './DurationInput.svelte';
  import { clone, describe, flatten, uid } from '../lib/core.ts';
  import { formatDuration } from '../lib/duration.ts';
  import { parseQuick, type QuickDefaults } from '../lib/quick.ts';
  import type { Exercise, Item, Superset } from '../lib/types.ts';

  let { items = $bindable() }: { items: Item[] } = $props();

  type Kind = Exercise['type'];
  type Base = { id: string; name: string; description?: string; restAfter?: number };
  const KINDS: { id: Kind; label: string; hint: string }[] = [
    { id: 'reps', label: 'Reps', hint: 'Sets of reps or holds. Can record a weight, a hold time or a note.' },
    { id: 'timed', label: 'Timed', hint: 'Rounds of work and rest run by the timer, e.g. 3 × 5s on, 5s off. Times take units: 45, 45s, 2min, 1h.' },
    { id: 'activity', label: 'Activity', hint: 'Anything else: a warm-up, a run, jumping jacks. You record the minutes or the count when you do it.' },
  ];

  /** New exercises start from the sets and reps of the last one added. */
  function defaults(): QuickDefaults {
    const last = flatten(items).map((f) => f.ex).findLast((ex) => ex.type === 'reps');
    return last?.type === 'reps'
      ? { sets: last.sets, reps: last.reps, repScheme: last.repScheme && [...last.repScheme], measure: last.measure, weightCount: last.weightCount, restBetweenSets: last.restBetweenSets }
      : { sets: 3, reps: 10, measure: 'weight' };
  }

  function blank(type: Kind, base: Base): Exercise {
    if (type === 'reps') return { ...base, type, ...defaults() };
    if (type === 'timed') return { ...base, type, reps: 6, workSec: 5, restSec: 5, trackWeight: false };
    return { ...base, type, measure: 'time' };
  }

  let open = $state(false);
  let draft = $state<Exercise>(blank('reps', { id: uid(), name: '' }));
  let inSuperset = $state(false);
  let isNew = $state(true);
  let restOpen = $state(false);
  let error = $state('');
  let nameInput = $state<HTMLInputElement>();
  // Where the draft goes when the sheet is confirmed.
  let list: (Item | Exercise)[] = [];
  let index = -1;

  function add(to: (Item | Exercise)[], superset: boolean) {
    list = to;
    index = -1;
    inSuperset = superset;
    isNew = true;
    restOpen = false;
    error = '';
    draft = blank('reps', { id: uid(), name: '' });
    open = true;
  }

  function edit(from: (Item | Exercise)[], i: number, superset: boolean) {
    list = from;
    index = i;
    inSuperset = superset;
    isNew = false;
    restOpen = false;
    error = '';
    draft = clone($state.snapshot(from[i])) as Exercise;
    open = true;
  }

  const int = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : fallback);
  const optional = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : undefined);

  async function apply(another = false) {
    draft.name = draft.name.trim();
    if (!draft.name) {
      error = 'Give the exercise a name.';
      nameInput?.focus();
      return;
    }
    draft.description = draft.description?.trim() || undefined;
    draft.restAfter = inSuperset ? undefined : optional(draft.restAfter);
    if (draft.type === 'reps') {
      const scheme = inSuperset ? [] : (draft.repScheme ?? []).filter((n) => n > 0);
      draft.repScheme = scheme.length ? scheme : undefined;
      draft.sets = inSuperset ? 1 : scheme.length || int(draft.sets, 1, 3);
      draft.reps = scheme[0] ?? int(draft.reps, 1, 1);
      draft.weightCount = draft.measure === 'weights' ? Math.min(6, int(draft.weightCount, 2, scheme.length || 2)) : undefined;
      draft.restBetweenSets = inSuperset ? undefined : optional(draft.restBetweenSets);
    } else if (draft.type === 'timed') {
      draft.reps = int(draft.reps, 1, 1);
      draft.workSec = int(draft.workSec, 1, 5);
      draft.restSec = int(draft.restSec, 0, 0);
    }
    const value = clone($state.snapshot(draft)) as Exercise;
    if (index < 0) list.push(value);
    else list[index] = value;
    if (!another) return (open = false);
    add(list, inSuperset);
    // Start the next one as a copy of the one just added: same type, sets, reps and rests.
    // Only the name and notes are specific to an exercise, so those start empty.
    draft = { ...clone(value), id: uid(), name: '', description: undefined };
    await tick();
    nameInput?.focus();
  }

  const parseScheme = (text: string) => (text.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0).slice(0, 20);

  function setVarying(on: boolean) {
    if (draft.type !== 'reps') return;
    const { sets, reps } = draft;
    draft.repScheme = on ? Array.from({ length: Math.max(1, sets) }, () => reps) : undefined;
    if (!on) draft.sets = draft.sets || 3;
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

  const restSummary = $derived.by(() => {
    const parts: string[] = [];
    if (draft.type === 'reps' && draft.restBetweenSets) parts.push(`${formatDuration(draft.restBetweenSets)} between sets`);
    if (draft.restAfter) parts.push(`${formatDuration(draft.restAfter)} after`);
    return parts.join(' · ') || 'none';
  });

  // ---- Adding several at once ----
  let severalOpen = $state(false);
  let severalText = $state('');
  const several = $derived(parseQuick(severalText, defaults()));

  function addSeveral() {
    if (!several.length) return;
    items.push(...several);
    severalText = '';
    severalOpen = false;
  }
</script>

{#snippet row(arr: (Item | Exercise)[], i: number, ex: Exercise, superset: boolean)}
  <div class="item">
    <button type="button" class="main" onclick={() => edit(arr, i, superset)}>
      <strong>{ex.name}</strong>
      <span class="muted">{describe(ex, superset)}{ex.restAfter ? ` · then rest ${formatDuration(ex.restAfter)}` : ''}</span>
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
        <label class="field"><span>Rest between rounds</span><DurationInput bind:value={item.restBetweenRounds} onchange={() => cleanSuperset(item)} /></label>
        <label class="field"><span>Rest after</span><DurationInput bind:value={item.restAfter} onchange={() => cleanSuperset(item)} /></label>
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

<div class="adders">
  <button type="button" class="btn" onclick={() => add(items, false)}><Icon name="plus" size={18} /> Exercise</button>
  <button type="button" class="btn" onclick={addSuperset}><Icon name="plus" size={18} /> Superset</button>
  <button type="button" class="btn wide-cell" onclick={() => (severalOpen = true)}><Icon name="lines" size={18} /> Add several at once</button>
</div>

<Sheet bind:open label={isNew ? 'Add exercise' : 'Edit exercise'}>
  <form onsubmit={(e) => { e.preventDefault(); void apply(); }}>
    <label class="field"><span>Name</span><input type="text" bind:this={nameInput} bind:value={draft.name} autocomplete="off" enterkeyhint="done" /></label>
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
      {#if !inSuperset}
        <fieldset>
          <legend>Reps</legend>
          <div class="chips">
            <label><input type="radio" name="scheme" checked={!draft.repScheme} onchange={() => setVarying(false)} />Same each set</label>
            <label><input type="radio" name="scheme" checked={!!draft.repScheme} onchange={() => setVarying(true)} />Varying</label>
          </div>
        </fieldset>
      {/if}
      {#if draft.repScheme && !inSuperset}
        <label class="field">
          <span>Reps in each set, in order</span>
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="5, 5, 10" value={draft.repScheme.join(', ')}
            onchange={(e) => { const list = parseScheme(e.currentTarget.value); if (draft.type === 'reps') draft.repScheme = list.length ? list : draft.repScheme; e.currentTarget.value = draft.type === 'reps' ? (draft.repScheme ?? []).join(', ') : ''; }} />
        </label>
      {:else}
        <div class="cols">
          {#if !inSuperset}<label class="field"><span>Sets</span><input type="number" inputmode="numeric" min="1" bind:value={draft.sets} /></label>{/if}
          <label class="field"><span>Reps per set</span><input type="number" inputmode="numeric" min="1" bind:value={draft.reps} /></label>
        </div>
      {/if}
      <fieldset>
        <legend>Record each workout</legend>
        <div class="chips">
          <label><input type="radio" name="measure" value="weight" bind:group={draft.measure} />Weight</label>
          <label><input type="radio" name="measure" value="weights" bind:group={draft.measure} />Several weights</label>
          <label><input type="radio" name="measure" value="time" bind:group={draft.measure} />Hold time</label>
          <label><input type="radio" name="measure" value="text" bind:group={draft.measure} />Text</label>
          <label><input type="radio" name="measure" value="none" bind:group={draft.measure} />Nothing</label>
        </div>
      </fieldset>
      {#if draft.measure === 'weights'}
        <label class="field"><span>How many weights (2–6)</span><input type="number" inputmode="numeric" min="2" max="6" value={draft.weightCount ?? draft.repScheme?.length ?? 2}
          onchange={(e) => { if (draft.type === 'reps') draft.weightCount = Math.min(6, Math.max(2, Math.round(Number(e.currentTarget.value)) || 2)); }} /></label>
        <p class="muted hint">One per set, or one for each movement of a combined exercise.</p>
      {/if}
    {:else if draft.type === 'timed'}
      <div class="cols">
        <label class="field"><span>Rounds</span><input type="number" inputmode="numeric" min="1" bind:value={draft.reps} /></label>
        <label class="field"><span>On</span><DurationInput bind:value={draft.workSec} min={1} placeholder="5s" /></label>
        <label class="field"><span>Off</span><DurationInput bind:value={draft.restSec} placeholder="5s" /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={draft.trackWeight} /> Record a weight</label>
    {:else}
      <fieldset>
        <legend>Record each workout</legend>
        <div class="chips">
          <label><input type="radio" name="ameasure" value="time" bind:group={draft.measure} />Minutes</label>
          <label><input type="radio" name="ameasure" value="count" bind:group={draft.measure} />Count</label>
          <label><input type="radio" name="ameasure" value="distance" bind:group={draft.measure} />Distance</label>
        </div>
      </fieldset>
    {/if}

    {#if !inSuperset}
      <details class="rest" bind:open={restOpen}>
        <summary><Icon name="clock" size={18} /> Rest <span class="muted">{restSummary}</span></summary>
        {#if draft.type === 'reps'}
          <label class="field"><span>Between sets</span><DurationInput bind:value={draft.restBetweenSets} placeholder="90s, 2min" /></label>
        {/if}
        <label class="field"><span>After the exercise</span><DurationInput bind:value={draft.restAfter} placeholder="2min" /></label>
      </details>
    {/if}
    <label class="field"><span>Notes (optional)</span><input type="text" bind:value={draft.description} autocomplete="off" /></label>

    <div class="row">
      {#if isNew}
        <button type="button" class="btn grow" onclick={() => apply(true)}>Add and next</button>
      {:else}
        <button type="button" class="btn danger" onclick={remove}>Remove</button>
      {/if}
      <button type="submit" class="btn primary grow">{isNew ? 'Add' : 'Done'}</button>
    </div>
  </form>
</Sheet>

<Sheet bind:open={severalOpen} label="Add several exercises">
  <form onsubmit={(e) => { e.preventDefault(); addSeveral(); }}>
    <label class="field">
      <span>One exercise per line</span>
      <textarea bind:value={severalText} rows="6" autocomplete="off" spellcheck="false" placeholder={'Pull-ups 4x6\nRows\nPlank 3x hold\nDead hang 6x5/5\nWarm-up min\nJumping jacks count'}></textarea>
    </label>
    <p class="muted hint">A name alone copies the sets and reps of the previous exercise. Add 4x6 for sets and reps, 3x hold for timed holds, 3x5/5 for 3 rounds of 5 s on and 5 s off, or end with min, count or km for an activity you record in minutes, as a count or as a distance.</p>
    {#if several.length}
      <ul class="preview" aria-label="What will be added">
        {#each several as ex (ex.id)}<li><strong>{ex.name}</strong> <span class="muted">{describe(ex)}</span></li>{/each}
      </ul>
    {/if}
    <button type="submit" class="btn primary wide" aria-disabled={several.length === 0}>{several.length ? `Add ${several.length} ${several.length === 1 ? 'exercise' : 'exercises'}` : 'Add'}</button>
  </form>
</Sheet>

<style>
  .item { display: flex; align-items: center; background: var(--card); border-radius: var(--radius); margin-bottom: 0.5rem; padding-right: 0.25rem; }
  .main { flex: 1; min-width: 0; display: grid; gap: 0.125rem; text-align: left; padding: 0.75rem; background: none; border: none; color: inherit; font: inherit; cursor: pointer; border-radius: var(--radius); }
  .superset { border: 2px dashed #7f77dd; border-radius: 20px; padding: 0.25rem 0.625rem 0.625rem; margin-bottom: 0.5rem; }
  .superset legend { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--accent); padding: 0 0.375rem; margin: 0; }
  .none { padding: 0.5rem 0.25rem 0.75rem; }
  .hint { margin-top: 0.375rem; }
  .adders { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .wide-cell { grid-column: 1 / -1; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin-bottom: 0.75rem; }
  .check input { width: 1.25rem; height: 1.25rem; }

  .rest { background: var(--bg); border-radius: var(--radius); padding: 0 0.75rem; margin-bottom: 0.75rem; }
  .rest summary { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; font-weight: 600; cursor: pointer; }
  .rest[open] { padding-bottom: 0.125rem; }
  .rest .muted { font-weight: 400; }

  textarea { resize: vertical; min-height: 8rem; }
  .preview { list-style: none; margin: 0.75rem 0; padding: 0.75rem; background: var(--bg); border-radius: var(--radius); display: grid; gap: 0.25rem; }
</style>
