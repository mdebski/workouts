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

  function done() {
    onset(draft);
    open = false;
  }
</script>

<Sheet bind:open label="Set value for {name}">
  <form onsubmit={(e) => { e.preventDefault(); done(); }}>
    <p class="muted center">{name}{last !== undefined ? ` · last time ${fmtValue(last, unit)}` : ''}</p>
    <label class="big">
      <span class="sr">Value in {unitLabel}</span>
      <input type="text" inputmode="decimal" autocomplete="off" value={fmtNum(draft)}
        onchange={(e) => { const n = Number(e.currentTarget.value.replace(',', '.')); draft = Number.isFinite(n) && n >= 0 ? n : draft; e.currentTarget.value = fmtNum(draft); }} />
      <span aria-hidden="true">{unitLabel}</span>
    </label>
    <div class="grid" style="--n: {steps.length}">
      {#each steps as s}<button type="button" class="btn" onclick={() => bump(-s)}>−{fmtNum(s)}</button>{/each}
      {#each steps as s}<button type="button" class="btn" onclick={() => bump(s)}>+{fmtNum(s)}</button>{/each}
    </div>
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
</style>
