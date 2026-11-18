<script lang="ts">
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { today } from '../lib/dates.ts';

  /** The "+" on both main tabs: one sheet to add a one-off workout or a programme. */
  let open = $state(false);
  const date = today();

  const CHOICES = [
    { href: `#/w/new/edit?date=${date}`, icon: 'bolt', title: 'One-off workout', text: 'A single session: one exercise or activity, or several' },
    { href: '#/p/new', icon: 'calendar', title: 'Programme', text: 'A workout that repeats on a schedule' },
  ] as const;
</script>

<button class="icon-btn add" aria-label="Add a workout or programme" aria-haspopup="dialog" onclick={() => (open = true)}><Icon name="plus" /></button>

<Sheet bind:open label="What do you want to add?">
  <nav class="choices" aria-label="Add">
    {#each CHOICES as c (c.href)}
      <a class="choice" href={c.href} onclick={() => (open = false)}>
        <span class="emoji" aria-hidden="true"><Icon name={c.icon} /></span>
        <span><strong>{c.title}</strong><span class="muted">{c.text}</span></span>
      </a>
    {/each}
  </nav>
</Sheet>

<style>
  .add { color: var(--accent); }
  .choices { display: grid; gap: 0.5rem; }
  .choice { display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem; border-radius: var(--radius); background: var(--raise); }
  .choice > span:last-child { display: grid; }
  .choice .emoji { background: var(--accent); color: var(--accent-ink); }
</style>
