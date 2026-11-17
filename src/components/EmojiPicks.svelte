<script lang="ts">
  import type { Snippet } from 'svelte';

  // Quick icon choices as a radio group: one Tab stop, arrow keys move between
  // emoji, the same as the other choice rows in the forms.

  interface Props {
    value: string;
    options: readonly string[];
    label?: string;
    /** Extra controls after the choices, e.g. a button for any other emoji. */
    after?: Snippet;
  }
  let { value = $bindable(), options, label = 'Pick an icon', after }: Props = $props();
  const name = $props.id();
</script>

<div class="picks">
  <div class="group" role="radiogroup" aria-label={label}>
    {#each options as e (e)}
      <label class="pick"><input type="radio" {name} value={e} bind:group={value} /><span aria-hidden="true">{e}</span><span class="sr">{e}</span></label>
    {/each}
  </div>
  {@render after?.()}
</div>

<style>
  .picks { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.75rem; }
  .group { display: contents; }
  .pick { position: relative; display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 12px; border: 2px solid transparent; background: var(--card); font-size: 1.25rem; cursor: pointer; }
  /* The radio stays in the page for the keyboard and screen readers; the tile is what you see. */
  .pick input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .pick:has(:checked) { border-color: var(--accent); }
  .pick:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .picks :global(.pick-other) { display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: 12px; color: var(--muted); border: 2px dashed var(--line); background: none; cursor: pointer; }
</style>
