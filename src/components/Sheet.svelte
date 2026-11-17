<script lang="ts">
  import type { Snippet } from 'svelte';
  import { closeDialog, isBackdropClick } from '../lib/toplayer.ts';

  let { open = $bindable(false), label, children }: { open: boolean; label: string; children: Snippet } = $props();
  let el: HTMLDialogElement;

  $effect(() => {
    if (open && !el.open) el.showModal();
    else if (!open && el.open) void closeDialog(el);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={el}
  class="sheet"
  closedby="any"
  aria-label={label}
  onclose={() => {
    // The close event can arrive after the exit animation. If the sheet has been
    // reopened in the meantime, this is the old close and must not shut the new one.
    if (!el.open) open = false;
  }}
  oncancel={(e) => {
    // Route Esc and light dismiss through the animated close.
    e.preventDefault();
    open = false;
  }}
  onclick={(e) => {
    if (isBackdropClick(el, e)) open = false;
  }}
>
  {@render children()}
</dialog>
