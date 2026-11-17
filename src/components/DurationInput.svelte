<script lang="ts">
  import { formatDuration, parseDuration } from '../lib/duration.ts';

  interface Props {
    /** Seconds, or undefined when the field is empty. */
    value: number | undefined;
    min?: number;
    placeholder?: string;
    onchange?: () => void;
  }
  let { value = $bindable(), min = 0, placeholder = '30s, 2min, 1h', onchange }: Props = $props();

  let text = $state(formatDuration(value));
  let invalid = $state(false);
  let focused = false;

  // Show outside changes (e.g. the whole form being reset) unless the user is typing.
  $effect(() => {
    const shown = formatDuration(value);
    if (!focused) text = shown;
  });

  function commit(e: Event & { currentTarget: HTMLInputElement }) {
    const parsed = parseDuration(text);
    invalid = parsed !== undefined && (Number.isNaN(parsed) || parsed < min);
    e.currentTarget.setCustomValidity(invalid ? `Enter a time like 45, 45s, 5min or 1h${min > 0 ? `, at least ${formatDuration(min)}` : ''}.` : '');
    if (invalid) return;
    value = parsed === undefined ? undefined : Math.round(parsed);
    text = formatDuration(value);
    onchange?.();
  }
</script>

<input
  type="text"
  autocomplete="off"
  autocapitalize="off"
  spellcheck="false"
  enterkeyhint="done"
  {placeholder}
  bind:value={text}
  aria-invalid={invalid}
  onfocus={() => (focused = true)}
  onblur={() => (focused = false)}
  onchange={commit}
/>
{#if invalid}<span class="hint" role="alert">Use a number of seconds, or add a unit: 45s, 5min, 1h.</span>{/if}

<style>
  .hint { display: block; color: var(--bad); font-size: 0.8125rem; margin-top: 0.25rem; font-weight: 400; }
  input[aria-invalid='true'] { border-color: var(--bad-line); }
</style>
