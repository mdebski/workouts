<script lang="ts">
  import DurationInput from './DurationInput.svelte';
  import { activityAmount, flatten, fmtNum, recordsText, recordsWeights, unitOf, weightCountOf } from '../lib/core.ts';
  import { formatDuration, parseDuration } from '../lib/duration.ts';
  import type { Exercise, Item, Result } from '../lib/types.ts';

  // What was done, entered straight into the workout form: values for each
  // exercise and whether it was done. Used for workouts logged after the fact.

  let { items, results = $bindable() }: { items: Item[]; results: Record<string, Result> } = $props();

  const flat = $derived(flatten(items));
  const r = (id: string) => (results[id] ??= { setsDone: 0 });
  const isDone = (id: string, sets: number) => (results[id]?.setsDone ?? 0) >= sets;

  function setDone(id: string, sets: number, on: boolean) {
    r(id).setsDone = on ? sets : 0;
  }

  /** Reads a typed number ("12,5" works too); empty clears it. Returns false if unreadable. */
  function readNumber(text: string): number | undefined | false {
    const t = text.trim().replace(',', '.');
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : false;
  }

  function setValue(ex: Exercise, sets: number, e: Event & { currentTarget: HTMLInputElement }) {
    const n = readNumber(e.currentTarget.value);
    if (n === false) {
      e.currentTarget.setCustomValidity('Enter a number.');
      e.currentTarget.reportValidity();
      return;
    }
    e.currentTarget.setCustomValidity('');
    if (n === undefined) delete r(ex.id).value;
    else r(ex.id).value = n;
    // An activity counts as done once an amount is recorded.
    if (ex.type === 'activity') setDone(ex.id, sets, (n ?? 0) > 0);
  }

  function setMinutes(ex: Exercise, sets: number, e: Event & { currentTarget: HTMLInputElement }) {
    const s = parseDuration(e.currentTarget.value, 'min');
    if (s !== undefined && Number.isNaN(s)) {
      e.currentTarget.setCustomValidity('Enter a time like 45, 1h or 1h 15min.');
      e.currentTarget.reportValidity();
      return;
    }
    e.currentTarget.setCustomValidity('');
    const minutes = s === undefined ? undefined : Math.round((s / 60) * 100) / 100;
    if (minutes === undefined) delete r(ex.id).value;
    else r(ex.id).value = minutes;
    e.currentTarget.value = minutes === undefined ? '' : formatDuration(minutes * 60);
    setDone(ex.id, sets, (minutes ?? 0) > 0);
  }

  function setSlot(ex: Exercise, i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const n = readNumber(e.currentTarget.value);
    if (n === false) return;
    const values = [...(results[ex.id]?.values ?? [])];
    while (values.length < weightCountOf(ex)) values.push(null);
    values[i] = n ?? null;
    r(ex.id).values = values;
  }

  const show = (v: number | undefined) => (v === undefined ? '' : fmtNum(v));
</script>

<ul class="records">
  {#each flat as { ex, sets } (ex.id)}
    {@const unit = unitOf(ex)}
    <li class="rec">
      <label class="tick">
        <input type="checkbox" checked={isDone(ex.id, sets)} onchange={(e) => setDone(ex.id, sets, e.currentTarget.checked)} aria-label="{ex.name} done" />
        <span class="name">{ex.name}</span>
      </label>
      <span class="value">
        {#if ex.type === 'activity' && ex.measure === 'time'}
          <input type="text" class="num wide" aria-label="{ex.name}, minutes" placeholder="45, 1h" value={results[ex.id]?.value === undefined ? '' : formatDuration(results[ex.id].value! * 60)} onchange={(e) => setMinutes(ex, sets, e)} autocomplete="off" />
        {:else if ex.type === 'activity'}
          <input type="text" class="num" inputmode="decimal" aria-label="{ex.name}, {activityAmount(ex).unit}" value={show(results[ex.id]?.value)} onchange={(e) => setValue(ex, sets, e)} autocomplete="off" />
          <span class="unit">{activityAmount(ex).unit}</span>
        {:else if recordsWeights(ex)}
          {#each { length: weightCountOf(ex) } as _, i}
            <input type="text" class="num small" inputmode="decimal" aria-label="{ex.name}, weight {i + 1}, kg" value={show(results[ex.id]?.values?.[i] ?? undefined)} onchange={(e) => setSlot(ex, i, e)} autocomplete="off" />
          {/each}
          <span class="unit">kg</span>
        {:else if recordsText(ex)}
          <input type="text" class="text" aria-label="{ex.name}, note" placeholder="Note" value={results[ex.id]?.text ?? ''} oninput={(e) => (r(ex.id).text = e.currentTarget.value || undefined)} autocomplete="off" />
        {:else if unit === 's'}
          <span class="dur"><DurationInput bind:value={() => results[ex.id]?.value, (v) => { if (v === undefined) delete r(ex.id).value; else r(ex.id).value = v; }} placeholder="45s" /></span>
        {:else if unit === 'kg'}
          <input type="text" class="num" inputmode="decimal" aria-label="{ex.name}, kg" value={show(results[ex.id]?.value)} onchange={(e) => setValue(ex, sets, e)} autocomplete="off" />
          <span class="unit">kg</span>
        {/if}
      </span>
    </li>
  {:else}
    <li class="muted">Add exercises above to record them.</li>
  {/each}
</ul>

<style>
  .records { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.375rem; }
  .rec { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; background: var(--card); border-radius: var(--radius); padding: 0.375rem 0.625rem; }
  .tick { flex: 1 1 8rem; min-width: 0; display: flex; align-items: center; gap: 0.625rem; min-height: 2.75rem; cursor: pointer; }
  .tick input { width: 1.375rem; height: 1.375rem; flex: none; }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .value { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
  .value input { min-height: 2.5rem; padding: 0.375rem 0.5rem; }
  .num { width: 5rem; text-align: right; font-variant-numeric: tabular-nums; }
  .num.small { width: 4rem; }
  .num.wide { width: 7.5rem; }
  .text { width: 11rem; }
  .dur { width: 7.5rem; display: block; }
  .unit { color: var(--muted); font-size: 0.875rem; }
</style>
