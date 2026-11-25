<script lang="ts">
  import type { Feel } from '../lib/types.ts';

  /** How an exercise felt: a green or amber dot for easy or hard, a red ✕ when it wasn't finished. */
  let { feel, label = true }: { feel: Feel; label?: boolean } = $props();
  const WORDS: Record<Feel, string> = { easy: 'Felt easy', hard: 'Felt hard', failed: 'Not finished' };
</script>

<span class="feel-mark {feel}" title={WORDS[feel]} aria-hidden={!label}>
  {#if feel === 'failed'}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  {/if}
  {#if label}<span class="sr">{WORDS[feel]}. </span>{/if}
</span>

<style>
  .feel-mark { display: inline-block; flex: none; width: 0.5rem; height: 0.5rem; border-radius: 50%; vertical-align: 0.1em; }
  .easy { background: var(--ok); }
  .hard { background: var(--warn); }
  /* Not finished stands out: a bold red cross rather than another dot. */
  .failed { width: 0.875rem; height: 0.875rem; border-radius: 0; vertical-align: -0.1em; color: var(--bad); }
  svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
