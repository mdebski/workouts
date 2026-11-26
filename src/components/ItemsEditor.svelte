<script lang="ts">
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { dragHandle, dragHandleZone, TRIGGERS } from 'svelte-dnd-action';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import DurationInput from './DurationInput.svelte';
  import { clone, describe, flatten, fmtNum, uid } from '../lib/core.ts';
  import { findKinds, fmtRecorded, gradesOf, isGradeKind, kindLabel, valuesFor } from '../lib/record.ts';
  import { formatDuration, parseDuration } from '../lib/duration.ts';
  import { parseQuick, type QuickDefaults } from '../lib/quick.ts';
  import { parseSteps, progressesByReps, repSteps, setRepSteps } from '../lib/progression.ts';
  import type { Progression } from '../lib/types.ts';
  import type { Exercise, Item, RecordKind, RecordValue, Rest, Result, Step, Superset } from '../lib/types.ts';

  /**
   * With `results` (when editing a workout rather than a programme), each exercise's
   * sheet also takes what was recorded for it: weights, times, grades, notes…
   */
  /** `progression`: the programme's, when it has one; exercises then get a reps list, one per step. */
  let { items = $bindable(), results = $bindable(), progression }: { items: Item[]; results?: Record<string, Result>; progression?: Progression } = $props();
  const recording = $derived(results !== undefined);

  type Kind = Exercise['type'];
  type Base = { id: string; name: string; description?: string; record: RecordKind[] };
  const KINDS: { id: Kind; label: string; hint: string }[] = [
    { id: 'reps', label: 'Reps', hint: 'Sets of reps or holds. Record a time to get a hold timer.' },
    { id: 'timed', label: 'Timed', hint: 'Rounds of work and rest run by the timer, e.g. 3 × 5s on, 5s off. Times take units: 45, 45s, 2min, 1h.' },
    { id: 'activity', label: 'Activity', hint: 'Anything else: a warm-up, a run, a climbing session. It\'s done once you record something.' },
  ];

  /** New exercises start from the sets and reps of the last one added. */
  function defaults(): QuickDefaults {
    const last = flatten(items).map((f) => f.ex).findLast((ex) => ex.type === 'reps');
    return last?.type === 'reps'
      ? { sets: last.sets, reps: last.reps, repScheme: last.repScheme && [...last.repScheme], record: [...last.record], restBetweenSets: last.restBetweenSets }
      : { sets: 3, reps: 10, record: ['weight'] };
  }

  function blank(type: Kind, base: Base): Exercise {
    if (type === 'reps') return { ...defaults(), ...base, type };
    if (type === 'timed') return { ...base, type, reps: 6, workSec: 5, restSec: 5 };
    return { ...base, type };
  }

  let open = $state(false);
  let draft = $state<Exercise>(blank('reps', { id: uid(), name: '', record: defaults().record }));
  let inSuperset = $state(false);
  let isNew = $state(true);
  let restOpen = $state(false);
  let notesOpen = $state(false);
  let error = $state('');
  let nameInput = $state<HTMLInputElement>();
  /** The values being edited in the sheet (workouts only), one per entry of the record list. */
  let draftValues = $state<RecordValue[]>([]);
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
    draft = blank('reps', { id: uid(), name: '', record: defaults().record });
    draftValues = draft.record.map(() => null);
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
    draftValues = valuesFor(draft, results?.[draft.id]);
    open = true;
  }

  const int = (v: unknown, min: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.round(v)) : fallback);
  const optional = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : undefined);

  function apply(another = false) {
    draft.name = draft.name.trim();
    if (!draft.name) {
      error = 'Give the exercise a name.';
      nameInput?.focus();
      return;
    }
    draft.description = draft.description?.trim() || undefined;
    if (draft.type === 'activity' && !draft.record.length) {
      error = 'Pick something to record: an activity is done once it has a value.';
      return;
    }
    if (draft.type === 'reps') {
      const scheme = inSuperset ? [] : (draft.repScheme ?? []).filter((n) => n > 0);
      draft.repScheme = scheme.length ? scheme : undefined;
      draft.sets = inSuperset ? 1 : scheme.length || int(draft.sets, 1, 3);
      draft.reps = scheme[0] ?? int(draft.reps, 1, 1);
      // A reps list (one per step) sets the reps itself: the first step's.
      if (progression && draft.steps?.length && progressesByReps(draft)) setRepSteps(draft, repSteps(draft));
      else delete draft.steps;
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
    draftValues = draft.record.map(() => null);
  }

  // Adding what gets recorded: type to narrow the list, tap one (or Enter for the first).
  let recordQuery = $state('');
  let recordListOpen = $state(false);
  const recordMatches = $derived(findKinds(recordQuery));

  /** Appends a kind under "Record each workout" (repeats are fine, e.g. two weights). */
  function addRecord(k: RecordKind) {
    draft.record.push(k);
    draftValues.push(null);
    recordQuery = '';
  }

  function removeRecord(i: number) {
    draft.record.splice(i, 1);
    draftValues.splice(i, 1);
  }

  /** "Weight", or "Weight 2" when there are several of the same kind. */
  const entryLabel = (record: RecordKind[], i: number) => {
    const k = record[i];
    const same = record.filter((r) => r === k).length;
    return same > 1 ? `${kindLabel(k)} ${record.slice(0, i + 1).filter((r) => r === k).length}` : kindLabel(k);
  };

  const parseScheme = (text: string) => (text.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0).slice(0, 20);

  function setVarying(on: boolean) {
    if (draft.type !== 'reps') return;
    const { sets, reps } = draft;
    draft.repScheme = on ? Array.from({ length: Math.max(1, sets) }, () => reps) : undefined;
    if (!on) draft.sets = draft.sets || 3;
  }

  /** Keeps the values typed in the sheet; ticks, feel and the dumbbell flag stay as they were. */
  function storeResult(ex: Exercise) {
    if (!results) return;
    const before = results[ex.id];
    const out: Result = { setsDone: before?.setsDone ?? 0 };
    if (before?.feel) out.feel = before.feel;
    if (before?.dumbbells && ex.record.includes('weight')) out.dumbbells = true;
    const values = ex.record.map((_, i) => draftValues[i] ?? null).map((v) => (typeof v === 'string' && !v.trim() ? null : v));
    if (values.some((v) => v !== null)) out.values = values;
    if (out.setsDone || out.feel || out.values) results[ex.id] = out;
    else delete results[ex.id];
  }

  /** A typed number for entry `i`, "12,5" too; empty clears it, anything unreadable is ignored. */
  function setDraftNumber(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const t = e.currentTarget.value.trim().replace(',', '.');
    const n = Number(t);
    if (!t) draftValues[i] = null;
    else if (Number.isFinite(n) && n >= 0) draftValues[i] = n;
    const v = draftValues[i];
    e.currentTarget.value = typeof v === 'number' ? fmtNum(v) : '';
  }

  /** The bin on an exercise row: removes it, and anything recorded for it in this workout. */
  function removeAt(arr: (Item | Step)[], i: number) {
    const it = arr[i];
    if (results && it && it.id in results) delete results[it.id];
    arr.splice(i, 1);
  }

  /** The copy button on an exercise row: the same exercise again, right below, with nothing recorded. */
  function cloneAt(arr: (Item | Step)[], i: number) {
    arr.splice(i + 1, 0, { ...clone($state.snapshot(arr[i])), id: uid() } as Exercise);
  }

  function remove() {
    if (results && draft.id in results) delete results[draft.id];
    if (index >= 0) list.splice(index, 1);
    open = false;
  }


  // ---- Reordering: svelte-dnd-action, by the handle ----
  // It animates rows into place and scrolls the page when you drag near an edge. The main
  // list and every superset share one zone type, so exercises and rests can be dragged into
  // and out of supersets. A superset itself can't go inside another one.
  const flipDurationMs = 150;
  type DndItems<T> = CustomEvent<{ items: T[]; info: { trigger: string; id: string } }>;
  let draggingSuperset = $state(false);
  function track(e: DndItems<Item | Step>) {
    if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) draggingSuperset = items.some((it) => it.id === e.detail.info.id && it.type === 'superset');
    if (e.type === 'finalize') draggingSuperset = false;
  }
  const reorderTop = (e: DndItems<Item>) => {
    track(e);
    items = e.detail.items;
  };
  const reorderSteps = (ss: Superset) => (e: DndItems<Step>) => {
    track(e);
    ss.items = e.detail.items;
  };

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
    <button type="button" class="icon-btn" aria-label="Copy {ex.name}" onclick={() => cloneAt(arr, i)}><Icon name="copy" /></button>
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
      <div class="sortable steps" data-empty="Drag exercises here, or add one" use:dragHandleZone={{ items: item.items, flipDurationMs, type: 'items', dropFromOthersDisabled: draggingSuperset, dropTargetStyle: {} }} onconsider={reorderSteps(item)} onfinalize={reorderSteps(item)}>
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

<Sheet bind:open focusSheet full label={isNew ? 'Add exercise' : 'Edit exercise'}>
  <form onsubmit={(e) => { e.preventDefault(); void apply(); }}>
    <div class="sheet-bar">
      <button type="button" class="icon-btn" aria-label="Cancel" onclick={() => (open = false)}><Icon name="x" /></button>
      <h2>{isNew ? 'Add exercise' : 'Edit exercise'}</h2>
    </div>
    <label class="field"><span>Name</span><input type="text" bind:this={nameInput} bind:value={draft.name} autocomplete="off" enterkeyhint="done" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <fieldset>
      <legend>Type</legend>
      <div class="chips">
        {#each KINDS as k}
          <label><input type="radio" name="kind" value={k.id} checked={draft.type === k.id} onchange={() => (draft = blank(k.id, { id: draft.id, name: draft.name, description: draft.description, record: draft.record }))} />{k.label}</label>
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
          {#if !(progression && draft.steps?.length)}<label class="field"><span>Reps per set</span><input type="number" inputmode="numeric" min="1" bind:value={draft.reps} /></label>{/if}
        </div>
      {/if}
      {#if progression && progressesByReps(draft)}
        <label class="field">
          <span>Reps at each {progression.unit === 'weeks' && progression.every === 1 ? 'week' : 'step'}{draft.repScheme ? ' (first set; the others move with it)' : ''}</span>
          <input type="text" inputmode="numeric" autocomplete="off" placeholder="Same every {progression.unit === 'weeks' && progression.every === 1 ? 'week' : 'step'}, or e.g. 6, 8, 10" value={repSteps(draft).join(', ')}
            onchange={(e) => { setRepSteps(draft, parseSteps(e.currentTarget.value)); e.currentTarget.value = repSteps(draft).join(', '); }} />
        </label>
      {/if}
    {:else if draft.type === 'timed'}
      <div class="cols">
        <label class="field"><span>Rounds</span><input type="number" inputmode="numeric" min="1" bind:value={draft.reps} /></label>
        <label class="field"><span>On</span><DurationInput bind:value={draft.workSec} min={1} placeholder="5s" /></label>
        <label class="field"><span>Off</span><DurationInput bind:value={draft.restSec} placeholder="5s" /></label>
      </div>
    {/if}

    <fieldset class="record-list">
      <legend>Record each workout</legend>
      <div class="pills">
        {#each draft.record as k, i (i)}
          <span class="pill">{entryLabel(draft.record, i)}<button type="button" class="pill-x" aria-label="Stop recording {entryLabel(draft.record, i).toLowerCase()}" onclick={() => removeRecord(i)}><Icon name="x" size={14} /></button></span>
        {/each}
      </div>
      <input type="search" class="add-record" placeholder={draft.record.length ? 'Add… (type to search)' : 'Add something to record…'} aria-label="Add something to record" autocomplete="off" enterkeyhint="done"
        bind:value={recordQuery} onfocus={() => (recordListOpen = true)} onblur={() => (recordListOpen = false)}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (recordMatches[0]) addRecord(recordMatches[0].id); } }} />
      {#if recordListOpen || recordQuery}
        <!-- Pressing an option keeps the focus in the field, so the list stays open for the next one. -->
        <div class="suggest" role="listbox" aria-label="Things to record">
          {#each recordMatches as k (k.id)}
            <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => addRecord(k.id)}>{k.label}</button>
          {:else}
            <span class="muted">Nothing matches "{recordQuery}"</span>
          {/each}
        </div>
      {/if}
      {#if !draft.record.length}<p class="muted hint">{draft.type === 'activity' ? 'An activity needs at least one, e.g. time or distance.' : 'Nothing: just tick the sets off.'}</p>{/if}
      {#if draft.record.includes('time') && draft.record.includes('distance')}<p class="muted hint">With a time and a distance, the workout shows your pace.</p>{/if}
    </fieldset>

    {#if recording && draft.record.length}
      <!-- Workouts only: what was done this time, straight away. -->
      <fieldset>
        <legend>This workout</legend>
        <div class="entries">
          {#each draft.record as k, i (i)}
            {@const label = entryLabel(draft.record, i)}
            {@const v = draftValues[i] ?? null}
            {#if k === 'time'}
              <label class="field"><span>{label}</span><DurationInput bind:value={() => (typeof v === 'number' ? v : undefined), (s) => (draftValues[i] = s ?? null)} placeholder="45s, 1h 15min" /></label>
            {:else if isGradeKind(k)}
              <label class="field"><span>{label}</span>
                <select value={typeof v === 'string' ? v : ''} onchange={(e) => (draftValues[i] = e.currentTarget.value || null)}>
                  <option value="">—</option>
                  {#each gradesOf(k) as g}<option value={g}>{g}</option>{/each}
                </select>
              </label>
            {:else if k === 'note'}
              <label class="field"><span>{label}</span><input type="text" autocomplete="off" placeholder="Band, grip, variation" value={typeof v === 'string' ? v : ''} oninput={(e) => (draftValues[i] = e.currentTarget.value || null)} /></label>
            {:else}
              <label class="field"><span>{label}{k === 'weight' ? ', kg' : k === 'distance' ? ', km' : ''}</span><input type="text" inputmode="decimal" autocomplete="off" value={typeof v === 'number' ? fmtNum(v) : ''} onchange={(e) => setDraftNumber(i, e)} /></label>
            {/if}
          {/each}
        </div>
      </fieldset>
    {/if}

    {#if !inSuperset && draft.type === 'reps'}
      <details class="rest" bind:open={restOpen}>
        <summary><Icon name={restOpen ? 'down' : 'right'} size={16} /><Icon name="clock" size={18} /> Rest <span class="muted">{restSummary}</span></summary>
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
  /* A superset's list stays a drop target when it's empty, with a word on how to fill it. */
  .steps { min-height: 2.75rem; }
  .steps:empty::before { content: attr(data-empty); display: grid; place-items: center; min-height: 2.75rem; margin-bottom: 0.5rem; border-radius: var(--radius); background: var(--bg); color: var(--muted); font-size: 0.875rem; }
  .none { padding: 0.5rem 0.25rem 0.75rem; }
  .hint { margin-top: 0.375rem; }
  /* Exercise, Superset and Rest share one row; "Add several" gets the next. */
  .adders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; }
  .adders .btn { padding-inline: 0.5rem; gap: 0.25rem; }
  .wide-cell { grid-column: 1 / -1; }

  .recorded { font-weight: 600; font-size: 0.875rem; color: var(--accent); }
  .sheet-bar { display: flex; align-items: center; gap: 0.5rem; margin: -0.25rem 0 0.75rem -0.5rem; }
  .sheet-bar h2 { margin: 0; font-size: 1.125rem; }
  /* What gets recorded: one pill per entry, then the list to add another. */
  .pills { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; }
  .pill { display: inline-flex; align-items: center; gap: 0.125rem; min-height: 2.25rem; padding: 0 0.25rem 0 0.75rem; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 0.875rem; font-weight: 600; }
  .pill-x { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border: none; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
  .pill-x:hover { background: rgb(0 0 0 / 0.15); }
  .add-record { margin-top: 0.5rem; }
  .suggest { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: 0.5rem; }
  .suggest button { min-height: 2.25rem; padding: 0 0.875rem; border: none; border-radius: 99px; background: var(--raise); color: var(--text); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .suggest button:hover { background: var(--line); }
  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0 0.5rem; }
  /* A rest: a red bar down the left edge rather than a full outline. */
  .rest-item { gap: 0.5rem; box-shadow: inset 4px 0 0 var(--bad-line); }
  /* Drag handle: the full height of the row, with a cursor that says it moves. */
  .handle { flex: none; display: grid; place-items: center; width: 2.25rem; align-self: stretch; color: var(--muted); cursor: grab; touch-action: none; border-radius: var(--radius); }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .rest-label { display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 600; }
  .rest-time { flex: 1; min-width: 0; }
  .rest-time :global(input) { min-height: 2.5rem; }
  .rest { background: var(--bg); border-radius: var(--radius); padding: 0 0.75rem; margin-bottom: 0.75rem; }
  .rest summary { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; font-weight: 600; cursor: pointer; list-style: none; }
  .rest summary::-webkit-details-marker { display: none; }
  .rest[open] { padding-bottom: 0.125rem; }
  .rest .muted { font-weight: 400; }

  textarea { resize: vertical; min-height: 8rem; }
  .preview { list-style: none; margin: 0.75rem 0; padding: 0.75rem; background: var(--bg); border-radius: var(--radius); display: grid; gap: 0.25rem; }
  .add-note { display: block; margin: -0.25rem 0 0.5rem; padding: 0.5rem 0.25rem; min-height: 2.75rem; border: none; background: none; color: var(--muted); font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
  .add-note:hover { color: var(--text); }
</style>
