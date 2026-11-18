<script lang="ts">
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { dragHandle, dragHandleZone } from 'svelte-dnd-action';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import DurationInput from './DurationInput.svelte';
  import { numberOf, numbersOf, textOf, clone, describe, flatten, fmtNum, fmtRecorded, recordsText, recordsWeights, uid, unitOf, weightCountOf } from '../lib/core.ts';
  import { formatDuration, parseDuration } from '../lib/duration.ts';
  import { parseQuick, type QuickDefaults } from '../lib/quick.ts';
  import type { Exercise, Item, Rest, Result, Step, Superset } from '../lib/types.ts';

  /**
   * With `results` (when editing a workout rather than a programme), each exercise's
   * sheet also takes what was recorded for it: weight, time, note or amount.
   */
  let { items = $bindable(), results = $bindable() }: { items: Item[]; results?: Record<string, Result> } = $props();
  const recording = $derived(results !== undefined);

  type Kind = Exercise['type'];
  type Base = { id: string; name: string; description?: string };
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
  let notesOpen = $state(false);
  let error = $state('');
  let nameInput = $state<HTMLInputElement>();
  /** The recorded value being edited in the sheet (workouts only), one field per kind of input. */
  type Draft = { value?: number; values?: (number | null)[]; text?: string };
  let draftResult = $state<Draft>({});
  const toDraft = (r: Result | undefined): Draft => ({ value: numberOf(r), values: numbersOf(r) && [...numbersOf(r)!], text: textOf(r) });
  // Where the draft goes when the sheet is confirmed.
  let list: (Item | Step)[] = [];
  let index = -1;

  function add(to: (Item | Step)[], superset: boolean) {
    list = to;
    index = -1;
    inSuperset = superset;
    isNew = true;
    restOpen = false;
    notesOpen = false;
    error = '';
    draft = blank('reps', { id: uid(), name: '' });
    draftResult = {};
    open = true;
  }

  function edit(from: (Item | Step)[], i: number, superset: boolean) {
    list = from;
    index = i;
    inSuperset = superset;
    isNew = false;
    restOpen = false;
    notesOpen = false;
    error = '';
    draft = clone($state.snapshot(from[i])) as Exercise;
    draftResult = toDraft(results?.[draft.id]);
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
    if (results) storeResult(value);
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

  /** Keeps only what this kind of exercise records; ticks and feel stay as they were. */
  function storeResult(ex: Exercise) {
    if (!results) return;
    const before = results[ex.id];
    const out: Result = { setsDone: before?.setsDone ?? 0 };
    if (before?.feel) out.feel = before.feel;
    if (recordsWeights(ex)) {
      const values = (draftResult.values ?? []).slice(0, weightCountOf(ex));
      if (values.some((v) => v !== null && v !== undefined)) out.recorded = values.map((v) => v ?? null);
    } else if (recordsText(ex)) {
      if (draftResult.text?.trim()) out.recorded = draftResult.text.trim();
    } else if (unitOf(ex) && draftResult.value !== undefined) {
      out.recorded = draftResult.value;
    }
    if (out.setsDone || out.feel || out.recorded !== undefined) results[ex.id] = out;
    else delete results[ex.id];
  }

  /** A typed number, "12,5" too; empty clears it, anything unreadable is ignored. */
  function readNumber(text: string): number | undefined | null {
    const t = text.trim().replace(',', '.');
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function setDraftValue(e: Event & { currentTarget: HTMLInputElement }) {
    const n = readNumber(e.currentTarget.value);
    if (n === null) return;
    draftResult.value = n;
  }

  function setDraftMinutes(e: Event & { currentTarget: HTMLInputElement }) {
    const s = parseDuration(e.currentTarget.value, 'min');
    if (s !== undefined && Number.isNaN(s)) return;
    draftResult.value = s === undefined ? undefined : Math.round((s / 60) * 100) / 100;
    e.currentTarget.value = draftResult.value === undefined ? '' : formatDuration(draftResult.value * 60);
  }

  function setDraftSlot(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const n = readNumber(e.currentTarget.value);
    if (n === null) return;
    const values = [...(draftResult.values ?? [])];
    while (values.length <= i) values.push(null);
    values[i] = n ?? null;
    draftResult.values = values;
  }

  /** The bin on an exercise row: removes it, and anything recorded for it in this workout. */
  function removeAt(arr: (Item | Step)[], i: number) {
    const it = arr[i];
    if (results && it && it.id in results) delete results[it.id];
    arr.splice(i, 1);
  }

  function remove() {
    if (results && draft.id in results) delete results[draft.id];
    if (index >= 0) list.splice(index, 1);
    open = false;
  }


  // ---- Reordering: svelte-dnd-action, by the handle, within each list ----
  // It animates rows into place and scrolls the page when you drag near an edge.
  // Each superset is its own zone type, so steps stay inside their superset.
  const flipDurationMs = 150;
  type DndItems<T> = CustomEvent<{ items: T[] }>;
  const reorderTop = (e: DndItems<Item>) => (items = e.detail.items);
  const reorderSteps = (ss: Superset) => (e: DndItems<Step>) => (ss.items = e.detail.items);

  function addSuperset() {
    items.push({ id: uid(), type: 'superset', rounds: 3, items: [] });
  }

  /** A rest of its own; it starts as long as the last rest added, or a minute. */
  function addRest(to: (Item | Step)[]) {
    const last = [...items, ...items.flatMap((it) => (it.type === 'superset' ? it.items : []))].findLast((it) => it.type === 'rest');
    to.push({ id: uid(), type: 'rest', seconds: last?.type === 'rest' ? last.seconds : 60 });
  }

  function cleanSuperset(s: Superset) {
    s.rounds = int(s.rounds, 1, 3);
  }

  const restSummary = $derived(draft.type === 'reps' && draft.restBetweenSets ? `${formatDuration(draft.restBetweenSets)} between sets` : 'none');

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

{#snippet handle(label: string)}
  <span class="handle" use:dragHandle aria-label="Move {label}"><Icon name="grip" /></span>
{/snippet}

{#snippet restRow(arr: (Item | Step)[], i: number, r: Rest)}
  <div class="item rest-item">
    {@render handle('rest')}
    <span class="rest-label"><Icon name="clock" size={18} /> Rest</span>
    <span class="rest-time"><DurationInput bind:value={() => r.seconds, (v) => (r.seconds = v && v > 0 ? v : 60)} min={1} placeholder="60s" /></span>
    <button type="button" class="icon-btn" aria-label="Remove rest" onclick={() => arr.splice(i, 1)}><Icon name="trash" /></button>
  </div>
{/snippet}

{#snippet row(arr: (Item | Step)[], i: number, ex: Exercise, superset: boolean)}
  <div class="item">
    {@render handle(ex.name)}
    <button type="button" class="main" onclick={() => edit(arr, i, superset)}>
      <strong>{ex.name}</strong>
      <span class="muted">{describe(ex, superset)}</span>
      {#if recording && fmtRecorded(ex, results?.[ex.id])}<span class="recorded">{fmtRecorded(ex, results?.[ex.id])}</span>{/if}
    </button>
    <button type="button" class="icon-btn" aria-label="Remove {ex.name}" onclick={() => removeAt(arr, i)}><Icon name="trash" /></button>
  </div>
{/snippet}

{#if items.length === 0}<p class="muted none">No exercises yet.</p>{/if}
<div class="sortable" use:dragHandleZone={{ items, flipDurationMs, type: 'items', dropTargetStyle: {} }} onconsider={reorderTop} onfinalize={reorderTop}>
{#each items as item, i (item.id)}
  <div class="slot" animate:flip={{ duration: flipDurationMs }}>
  {#if item.type === 'superset'}
    <fieldset class="superset">
      <legend><Icon name="repeat" size={16} /> Superset</legend>
      <div class="cols">
        <label class="field"><span>Rounds</span><input type="number" inputmode="numeric" min="1" bind:value={item.rounds} onchange={() => cleanSuperset(item)} /></label>
      </div>
      <div class="sortable" use:dragHandleZone={{ items: item.items, flipDurationMs, type: `steps-${item.id}`, dropTargetStyle: {} }} onconsider={reorderSteps(item)} onfinalize={reorderSteps(item)}>
        {#each item.items as step, j (step.id)}
          <div class="slot" animate:flip={{ duration: flipDurationMs }}>
            {#if step.type === 'rest'}{@render restRow(item.items, j, step)}{:else}{@render row(item.items, j, step, true)}{/if}
          </div>
        {/each}
      </div>
      <div class="row">
        {@render handle('superset')}
        <button type="button" class="btn small grow" onclick={() => add(item.items, true)}><Icon name="plus" size={18} /> Exercise</button>
        <button type="button" class="btn small grow" onclick={() => addRest(item.items)}><Icon name="clock" size={18} /> Rest</button>
        <button type="button" class="icon-btn" aria-label="Remove superset" onclick={() => items.splice(i, 1)}><Icon name="trash" /></button>
      </div>
    </fieldset>
  {:else if item.type === 'rest'}
    {@render restRow(items, i, item)}
  {:else}
    {@render row(items, i, item, false)}
  {/if}
  </div>
{/each}
</div>

<div class="adders">
  <button type="button" class="btn" onclick={() => add(items, false)}><Icon name="plus" size={18} /> Exercise</button>
  <button type="button" class="btn" onclick={addSuperset}><Icon name="plus" size={18} /> Superset</button>
  <button type="button" class="btn" onclick={() => addRest(items)}><Icon name="clock" size={18} /> Rest</button>
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
          <label><input type="radio" name="kind" value={k.id} checked={draft.type === k.id} onchange={() => (draft = blank(k.id, { id: draft.id, name: draft.name, description: draft.description }))} />{k.label}</label>
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

    {#if recording}
      <!-- Workouts only: what was done this time, straight away. -->
      {@const unit = unitOf(draft)}
      {#if draft.type === 'activity' && draft.measure === 'time'}
        <label class="field"><span>How long</span><input type="text" placeholder="45, 1h 15min" autocomplete="off" value={draftResult.value === undefined ? '' : formatDuration(draftResult.value * 60)} onchange={setDraftMinutes} /></label>
      {:else if draft.type === 'activity'}
        <label class="field"><span>{draft.measure === 'distance' ? 'How far, km' : 'How many'}</span><input type="text" inputmode="decimal" autocomplete="off" value={draftResult.value === undefined ? '' : fmtNum(draftResult.value)} onchange={setDraftValue} /></label>
      {:else if recordsWeights(draft)}
        <fieldset>
          <legend>Weights, kg</legend>
          <div class="row slots">
            {#each { length: weightCountOf(draft) } as _, i}
              <input type="text" inputmode="decimal" autocomplete="off" aria-label="Weight {i + 1}, kg" value={draftResult.values?.[i] == null ? '' : fmtNum(draftResult.values[i]!)} onchange={(e) => setDraftSlot(i, e)} />
            {/each}
          </div>
        </fieldset>
      {:else if recordsText(draft)}
        <label class="field"><span>Note</span><input type="text" autocomplete="off" placeholder="Band, grip, variation" bind:value={draftResult.text} /></label>
      {:else if unit === 's'}
        <label class="field"><span>Hold time</span><DurationInput bind:value={draftResult.value} placeholder="45s" /></label>
      {:else if unit === 'kg'}
        <label class="field"><span>Weight, kg</span><input type="text" inputmode="decimal" autocomplete="off" value={draftResult.value === undefined ? '' : fmtNum(draftResult.value)} onchange={setDraftValue} /></label>
      {/if}
    {/if}

    {#if !inSuperset && draft.type === 'reps'}
      <details class="rest" bind:open={restOpen}>
        <summary><Icon name="clock" size={18} /> Rest <span class="muted">{restSummary}</span></summary>
        <label class="field"><span>Between sets</span><DurationInput bind:value={draft.restBetweenSets} placeholder="90s, 2min" /></label>
      </details>
    {/if}
    <!-- Notes only take space once there are some, or you ask to add them, as in the workout. -->
    {#if draft.description || notesOpen}
      <!-- svelte-ignore a11y_autofocus -->
      <label class="field"><span>Notes</span><input type="text" bind:value={draft.description} autocomplete="off" autofocus={notesOpen && !draft.description} /></label>
    {:else}
      <button type="button" class="add-note" onclick={() => (notesOpen = true)}>Notes +</button>
    {/if}

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
    <p class="muted hint">A name alone copies the sets and reps of the previous exercise. Add 4x6 for sets and reps, 3x hold for timed holds, 3x5/5 for 3 rounds of 5 s on and 5 s off, end with min, count or km for an activity you record in minutes, as a count or as a distance, or write Rest 90s for a rest.</p>
    {#if several.length}
      <ul class="preview" aria-label="What will be added">
        {#each several as ex (ex.id)}<li>{#if ex.type === 'rest'}<strong>Rest</strong> <span class="muted">{formatDuration(ex.seconds)}</span>{:else}<strong>{ex.name}</strong> <span class="muted">{describe(ex)}</span>{/if}</li>{/each}
      </ul>
    {/if}
    <button type="submit" class="btn primary wide" aria-disabled={several.length === 0}>{several.length ? `Add ${several.length} ${several.length === 1 ? 'exercise' : 'exercises'}` : 'Add'}</button>
  </form>
</Sheet>

<style>
  .item { display: flex; align-items: center; background: var(--card); border-radius: var(--radius); margin-bottom: 0.5rem; padding-right: 0.25rem; }
  .main { flex: 1; min-width: 0; display: grid; gap: 0.125rem; text-align: left; padding: 0.75rem 0.75rem 0.75rem 0.25rem; background: none; border: none; color: inherit; font: inherit; cursor: pointer; border-radius: var(--radius); }
  .superset { border: 2px dashed #7f77dd; border-radius: 20px; padding: 0.25rem 0.625rem 0.625rem; margin-bottom: 0.5rem; }
  .superset legend { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--accent); padding: 0 0.375rem; margin: 0; }
  .none { padding: 0.5rem 0.25rem 0.75rem; }
  .hint { margin-top: 0.375rem; }
  /* Exercise, Superset and Rest share one row; "Add several" gets the next. */
  .adders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; }
  .adders .btn { padding-inline: 0.5rem; gap: 0.25rem; }
  .wide-cell { grid-column: 1 / -1; }
  .check { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin-bottom: 0.75rem; }
  .check input { width: 1.25rem; height: 1.25rem; }

  .recorded { font-weight: 600; font-size: 0.875rem; color: var(--accent); }
  .slots input { flex: 1; min-width: 0; text-align: right; }
  /* A rest: a red bar down the left edge rather than a full outline. */
  .rest-item { gap: 0.5rem; box-shadow: inset 4px 0 0 var(--bad-line); }
  /* Drag handle: the whole height of the row, with a cursor that says it moves. */
  /* Drag handle: the full height of the row, with a cursor that says it moves. */
  .handle { flex: none; display: grid; place-items: center; width: 2.25rem; align-self: stretch; color: var(--muted); cursor: grab; touch-action: none; border-radius: var(--radius); }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .rest-label { display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 600; }
  .rest-time { flex: 1; min-width: 0; }
  .rest-time :global(input) { min-height: 2.5rem; }
  .rest { background: var(--bg); border-radius: var(--radius); padding: 0 0.75rem; margin-bottom: 0.75rem; }
  .rest summary { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; font-weight: 600; cursor: pointer; }
  .rest[open] { padding-bottom: 0.125rem; }
  .rest .muted { font-weight: 400; }

  textarea { resize: vertical; min-height: 8rem; }
  .preview { list-style: none; margin: 0.75rem 0; padding: 0.75rem; background: var(--bg); border-radius: var(--radius); display: grid; gap: 0.25rem; }
  .add-note { display: block; margin: -0.25rem 0 0.5rem; padding: 0.5rem 0.25rem; min-height: 2.75rem; border: none; background: none; color: var(--muted); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .add-note:hover { color: var(--text); }
</style>
