<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { fmtNum, fmtValue, type Unit } from '../lib/core.ts';
  import type { Feel } from '../lib/types.ts';
  import { parseDuration } from '../lib/duration.ts';

  interface Props {
    open: boolean;
    name: string;
    unit: Unit;
    value: number | undefined;
    last: number | undefined;
    steps: number[];
    onset: (v: number) => void;
    /** When given, the sheet shows a dumbbell checkbox (weights only). */
    dumbbells?: boolean;
    ondumbbells?: (on: boolean) => void;
    /** How the exercise felt; when onfeel is given, the sheet shows Easy / Hard / Not finished. */
    feel?: Feel;
    onfeel?: (f: Feel | undefined) => void;
  }
  let { open = $bindable(false), name, unit, value, last, steps, onset, dumbbells, ondumbbells, feel, onfeel }: Props = $props();

  const FEELS: { id: Feel; label: string; icon: string }[] = [
    { id: 'easy', label: 'Easy', icon: '🙂' },
    { id: 'hard', label: 'Hard', icon: '😣' },
    { id: 'failed', label: 'Not finished', icon: '❌' },
  ];

  let draft = $state(0);
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) draft = value ?? last ?? 0;
    wasOpen = open;
  });

  /** Times accept units ("1min", "90s", "1:30"); the result is in this sheet's unit. */
  function readNumber(text: string): number | undefined {
    if (unit === 's') return parseDuration(text, 's');
    if (unit === 'min') {
      const s = parseDuration(text, 'min');
      return s === undefined ? undefined : Math.round((s / 60) * 100) / 100;
    }
    return Number(text.replace(',', '.'));
  }

  const bump = (d: number) => (draft = Math.max(0, Math.round((draft + d) * 100) / 100));
  const unitLabel = $derived(unit === '×' ? 'times' : unit);
  const counter = $derived(unit === '×');

  function done() {
    onset(draft);
    open = false;
  }
</script>

<Sheet bind:open label="Set value for {name}">
  <form onsubmit={(e) => { e.preventDefault(); done(); }}>
    <p class="muted center">{name}{last !== undefined ? ` · last time ${fmtValue(last, unit)}` : ''}</p>
    {#snippet number()}
      <label class="big">
        <span class="sr">Value in {unitLabel}</span>
        <!-- Times need letters for units (5min, 1h), so they get the full keyboard. -->
        <input type="text" inputmode={unit === 's' || unit === 'min' ? 'text' : 'decimal'} autocomplete="off" value={fmtNum(draft)}
          onchange={(e) => { const n = readNumber(e.currentTarget.value); draft = n !== undefined && Number.isFinite(n) && n >= 0 ? n : draft; e.currentTarget.value = fmtNum(draft); }} />
        {#if !counter}<span aria-hidden="true">{unitLabel}</span>{/if}
      </label>
    {/snippet}

    {#if counter}
      <!-- A plain count: the number in the middle with one-step buttons either side. -->
      <div class="counter">
        <button type="button" class="step" aria-label="One fewer" onclick={() => bump(-1)}>−</button>
        {@render number()}
        <button type="button" class="step" aria-label="One more" onclick={() => bump(1)}>+</button>
      </div>
    {:else}
      {@render number()}
      <div class="grid" style="--n: {steps.length}">
        {#each steps as s}<button type="button" class="btn" onclick={() => bump(-s)}>−{fmtNum(s)}</button>{/each}
        {#each steps as s}<button type="button" class="btn" onclick={() => bump(s)}>+{fmtNum(s)}</button>{/each}
      </div>
    {/if}
    {#if onfeel}
      <div class="feels" role="group" aria-label="How did it feel?">
        {#each FEELS as f}
          <button type="button" class="btn small {f.id}" aria-pressed={feel === f.id} onclick={() => onfeel(feel === f.id ? undefined : f.id)}><span aria-hidden="true">{f.icon}</span> {f.label}</button>
        {/each}
      </div>
    {/if}
    {#if ondumbbells}
      <label class="dumbbells"><input type="checkbox" checked={!!dumbbells} onchange={(e) => ondumbbells(e.currentTarget.checked)} /> Dumbbells <span class="muted">· weight is per dumbbell</span></label>
    {/if}
    <div class="row">
      {#if last !== undefined}<button type="button" class="btn grow" onclick={() => (draft = last)}>Same as last</button>{/if}
      <!-- Focus lands here, not on the number field, so the keyboard stays down on phones. -->
      <!-- svelte-ignore a11y_autofocus -->
      <button type="submit" class="btn primary grow" autofocus>Done</button>
    </div>
  </form>
</Sheet>

<style>
  .center { text-align: center; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .big { display: flex; align-items: baseline; justify-content: center; gap: 0.5rem; margin: 0.5rem 0 1rem; color: var(--muted); }
  .big input { width: 9rem; text-align: center; font-size: 2.25rem; font-weight: 650; border-color: transparent; background: none; padding: 0; }
  .big input:focus-visible { border-color: var(--accent); outline: none; }
  .grid { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
  .grid .btn { font-size: 1.0625rem; }
  .feels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; margin-bottom: 0.75rem; }
  .feels .btn[aria-pressed='true'].easy { background: var(--ok); color: var(--ok-ink); }
  .feels .btn[aria-pressed='true'].hard { background: var(--warn); color: var(--warn-ink); }
  .feels .btn[aria-pressed='true'].failed { background: var(--bad); color: var(--bad-ink); }
  .dumbbells { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; margin: -0.25rem 0 0.75rem; font-weight: 600; cursor: pointer; }
  .dumbbells input { width: 1.25rem; height: 1.25rem; }
  .dumbbells .muted { font-weight: 400; }
  .counter { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin: 0.75rem 0 1.25rem; }
  .counter .big { margin: 0; }
  .counter .big input { width: 7rem; font-size: 3rem; }
  .step { flex: none; width: 4.5rem; height: 4.5rem; border: none; border-radius: 50%; background: var(--raise); color: var(--text); font: inherit; font-size: 2.25rem; font-weight: 600; line-height: 1; cursor: pointer; touch-action: manipulation; }
  .step:hover { background: var(--line); }
</style>
