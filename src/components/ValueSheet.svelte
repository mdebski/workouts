<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { fmtNum, fmtValue, type Unit } from '../lib/core.ts';

  interface Props {
    open: boolean;
    name: string;
    unit: Unit;
    value: number | undefined;
    last: number | undefined;
    steps: number[];
    onset: (v: number) => void;
  }
  let { open = $bindable(false), name, unit, value, last, steps, onset }: Props = $props();

  let draft = $state(0);
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) draft = value ?? last ?? 0;
    wasOpen = open;
  });

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
        <input type="text" inputmode="decimal" autocomplete="off" value={fmtNum(draft)}
          onchange={(e) => { const n = Number(e.currentTarget.value.replace(',', '.')); draft = Number.isFinite(n) && n >= 0 ? n : draft; e.currentTarget.value = fmtNum(draft); }} />
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
  .counter { display: flex; align-items: center; justify-content: center; gap: 0.75rem; margin: 0.75rem 0 1.25rem; }
  .counter .big { margin: 0; }
  .counter .big input { width: 7rem; font-size: 3rem; }
  .step { flex: none; width: 4.5rem; height: 4.5rem; border: none; border-radius: 50%; background: var(--raise); color: var(--text); font: inherit; font-size: 2.25rem; font-weight: 600; line-height: 1; cursor: pointer; touch-action: manipulation; }
  .step:hover { background: var(--line); }
</style>
