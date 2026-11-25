<script lang="ts">
  import type { Snippet } from 'svelte';
  import { closeDialog, isBackdropClick } from '../lib/toplayer.ts';

  /** focusSheet: opening focuses the sheet itself, not its first field, so the keyboard stays down. */
  /** full: takes the whole screen, for longer forms whose height changes as you fill them in. */
  let { open = $bindable(false), label, focusSheet = false, full = false, children }: { open: boolean; label: string; focusSheet?: boolean; full?: boolean; children: Snippet } = $props();
  let el: HTMLDialogElement;

  $effect(() => {
    if (open && !el.open) {
      el.showModal();
      if (focusSheet) el.focus();
    }
    else if (!open && el.open) void closeDialog(el);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<dialog
  bind:this={el}
  tabindex={focusSheet ? -1 : undefined}
  class="sheet"
  class:full
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
