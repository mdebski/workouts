<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    open?: boolean;
    /** Shown next to the title while folded, so the section still says what's in it. */
    summary?: string;
    actions?: Snippet;
    children: Snippet;
  }
  let { title, open = $bindable(true), summary = '', actions, children }: Props = $props();
  const id = $props.id();
</script>

<section>
  <div class="head">
    <h2>
      <button type="button" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
        <Icon name={open ? 'down' : 'right'} size={16} />
        <span>{title}</span>
        {#if !open && summary}<span class="summary">{summary}</span>{/if}
      </button>
    </h2>
    {#if actions && open}{@render actions()}{/if}
  </div>
  <div {id} hidden={!open}>{@render children()}</div>
</section>

<style>
  .head { display: flex; align-items: center; gap: 0.25rem; min-height: 2.75rem; margin-top: 0.75rem; }
  h2 { flex: 1; min-width: 0; margin: 0; }
  button { display: flex; align-items: center; gap: 0.375rem; width: 100%; min-height: 2.75rem; padding: 0 0.25rem; background: none; border: none; border-radius: 12px; color: var(--muted); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
  .summary { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary::before { content: '· '; }
</style>
