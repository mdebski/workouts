<script lang="ts">
  import Sheet from './Sheet.svelte';
  import GradeWheel from './GradeWheel.svelte';
  import { fmtNum, fmtOne, isGradeKind, kindLabel, paceOf } from '../lib/record.ts';
  import { formatDuration, parseDuration } from '../lib/duration.ts';
  import type { Exercise, Feel, RecordKind, RecordValue } from '../lib/types.ts';

  /**
   * Everything recorded for one exercise in one place: each value in its record list,
   * how it felt (once for the exercise) and, with a weight, the dumbbell flag. Nothing
   * changes until Done.
   */
  interface Props {
    open: boolean;
    ex: Exercise;
    values: RecordValue[];
    /** Last time's values, entry for entry; shown beside each one and used by "Same as last". */
    last: RecordValue[];
    feel?: Feel;
    dumbbells?: boolean;
    /** The − / + step for a kind of value (kg, seconds, km or one). */
    stepOf: (k: RecordKind) => number;
    onsave: (r: { values: RecordValue[]; feel?: Feel; dumbbells: boolean }) => void;
  }
  let { open = $bindable(false), ex, values, last, feel, dumbbells, stepOf, onsave }: Props = $props();

  const FEELS: { id: Feel; label: string }[] = [
    { id: 'easy', label: 'Easy' },
    { id: 'hard', label: 'Hard' },
    { id: 'failed', label: 'Not finished' },
  ];

  let draft = $state<RecordValue[]>([]);
  let draftFeel = $state<Feel | undefined>();
  let draftDumbbells = $state(false);
  /** The form is only built once the draft holds this exercise's values, so the grade wheels open on them. */
  let ready = $state(false);
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      draft = ex.record.map((_, i) => values[i] ?? null);
      draftFeel = feel;
      draftDumbbells = !!dumbbells;
      ready = true;
    }
    if (!open) ready = false;
    wasOpen = open;
  });

  /** "Weight", or "Weight 2" when there are several of the same kind. */
  const labelOf = (i: number) => {
    const k = ex.record[i];
    const n = ex.record.filter((r) => r === k).length;
    return n > 1 ? `${kindLabel(k)} ${ex.record.slice(0, i + 1).filter((r) => r === k).length}` : kindLabel(k);
  };
  const unitWord = (k: RecordKind) => (k === 'weight' ? 'kg' : k === 'distance' ? 'km' : k === 'count' ? 'times' : '');
  const shown = (k: RecordKind, v: RecordValue) => (typeof v !== 'number' ? '' : k === 'time' ? formatDuration(v) || '0' : fmtNum(v));

  function readInto(i: number, e: Event & { currentTarget: HTMLInputElement }) {
    const k = ex.record[i];
    const text = e.currentTarget.value.trim();
    const n = !text ? null : k === 'time' ? (parseDuration(text, ex.type === 'activity' ? 'min' : 's') ?? null) : Number(text.replace(',', '.'));
    if (n === null) draft[i] = null;
    else if (Number.isFinite(n) && n >= 0) draft[i] = Math.round(n * 100) / 100;
    e.currentTarget.value = shown(k, draft[i]);
  }

  function step(i: number, d: 1 | -1) {
    const k = ex.record[i];
    const now = draft[i];
    const base = typeof now === 'number' ? now : typeof last[i] === 'number' ? (last[i] as number) : 0;
    draft[i] = Math.max(0, Math.round((base + d * stepOf(k)) * 100) / 100);
  }

  const hasLast = $derived(last.some((v) => v !== null));
  const pace = $derived(paceOf(ex, { setsDone: 0, values: draft }));

  function sameAsLast() {
    draft = ex.record.map((_, i) => last[i] ?? draft[i] ?? null);
  }

  function done() {
    onsave({ values: draft.map((v) => (typeof v === 'string' && !v.trim() ? null : v)), feel: draftFeel, dumbbells: draftDumbbells });
    open = false;
  }
</script>

<Sheet bind:open focusSheet label="Record {ex.name}">
  {#if open && ready}
    <form onsubmit={(e) => { e.preventDefault(); done(); }}>
      <p class="title">{ex.name}</p>
      <div class="entries">
        {#each ex.record as k, i (i)}
          {@const lastText = last[i] === null ? '' : fmtOne(k, last[i])}
          <div class="entry" class:wide={k === 'note'}>
            <span class="label">{labelOf(i)}{#if lastText}<span class="muted"> · last {lastText}</span>{/if}</span>
            {#if k === 'note'}
              <textarea rows="2" aria-label={labelOf(i)} value={typeof draft[i] === 'string' ? draft[i] : ''} oninput={(e) => (draft[i] = e.currentTarget.value || null)}></textarea>
            {:else if isGradeKind(k)}
              <GradeWheel kind={k} bind:value={() => (typeof draft[i] === 'string' ? (draft[i] as string) : null), (g) => (draft[i] = g)} start={typeof last[i] === 'string' ? (last[i] as string) : null} label={labelOf(i)} />
              {#if draft[i] !== null}<button type="button" class="clear" onclick={() => (draft[i] = null)}>Clear</button>{/if}
            {:else}
              <div class="number">
                <button type="button" class="step" aria-label="{labelOf(i)}: less" onclick={() => step(i, -1)}>−</button>
                <input type="text" inputmode={k === 'time' ? 'text' : 'decimal'} autocomplete="off" aria-label="{labelOf(i)}{unitWord(k) ? `, ${unitWord(k)}` : ''}"
                  placeholder={k === 'time' ? (ex.type === 'activity' ? '45min' : '45s') : '–'} value={shown(k, draft[i])} onchange={(e) => readInto(i, e)} />
                {#if unitWord(k)}<span class="unit" aria-hidden="true">{unitWord(k)}</span>{/if}
                <button type="button" class="step" aria-label="{labelOf(i)}: more" onclick={() => step(i, 1)}>+</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {#if pace}<p class="pace">Pace {pace}</p>{/if}

      <div class="feels" role="group" aria-label="How did it feel?">
        {#each FEELS as f}
          <button type="button" class="btn small {f.id}" aria-pressed={draftFeel === f.id} onclick={() => (draftFeel = draftFeel === f.id ? undefined : f.id)}><span class="dot" aria-hidden="true"></span> {f.label}</button>
        {/each}
      </div>
      {#if ex.record.includes('weight')}
        <label class="dumbbells"><input type="checkbox" bind:checked={draftDumbbells} /> Dumbbells <span class="muted">· weight is per dumbbell</span></label>
      {/if}
      <div class="row">
        {#if hasLast}<button type="button" class="btn grow" onclick={sameAsLast}>Same as last</button>{/if}
        <button type="submit" class="btn primary grow">Done</button>
      </div>
    </form>
  {/if}
</Sheet>

<style>
  .title { text-align: center; font-weight: 600; margin: 0 0 0.75rem; }
  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.75rem 0.625rem; margin-bottom: 0.75rem; }
  .entry { display: grid; gap: 0.375rem; align-content: start; min-width: 0; }
  .entry.wide { grid-column: 1 / -1; }
  .label { font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label .muted { font-weight: 400; }
  .number { display: flex; align-items: center; gap: 0.25rem; background: var(--bg); border-radius: 12px; padding: 0.25rem; }
  .number input { flex: 1; min-width: 0; text-align: center; font-size: 1.25rem; font-weight: 650; font-variant-numeric: tabular-nums; border-color: transparent; background: none; padding: 0; min-height: 2.5rem; }
  .number input:focus-visible { border-color: var(--accent); outline: none; }
  .unit { color: var(--muted); font-size: 0.8125rem; }
  .step { flex: none; width: 2.5rem; height: 2.5rem; border: none; border-radius: 50%; background: var(--raise); color: var(--text); font: inherit; font-size: 1.375rem; font-weight: 600; line-height: 1; cursor: pointer; touch-action: manipulation; }
  .step:hover { background: var(--line); }
  .clear { justify-self: center; min-height: 2rem; padding: 0 0.75rem; border: none; background: none; color: var(--muted); font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
  textarea { field-sizing: content; min-height: 3rem; resize: vertical; }
  .pace { margin: -0.25rem 0 0.75rem; text-align: center; color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
  .feels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; margin-bottom: 0.75rem; }
  .feels .btn { padding-inline: 0.375rem; white-space: nowrap; }
  .dot { display: inline-block; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--feel); flex: none; }
  .feels .easy { --feel: var(--ok); }
  .feels .hard { --feel: var(--warn); }
  .feels .failed { --feel: var(--bad); }
  .feels .btn[aria-pressed='true'] .dot { box-shadow: 0 0 0 2px currentColor; }
  .feels .btn[aria-pressed='true'].easy { background: var(--ok); color: var(--ok-ink); }
  .feels .btn[aria-pressed='true'].hard { background: var(--warn); color: var(--warn-ink); }
  .feels .btn[aria-pressed='true'].failed { background: var(--bad); color: var(--bad-ink); }
  .dumbbells { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin: -0.25rem 0 0.75rem; font-weight: 600; cursor: pointer; }
  .dumbbells input { width: 1.25rem; height: 1.25rem; }
  .dumbbells .muted { font-weight: 400; }
</style>
