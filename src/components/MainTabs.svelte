<script lang="ts">
  /** The title of the two main screens, doubling as a switch between them. */
  let { active }: { active: 'workouts' | 'programmes' } = $props();

  const TABS = [
    { id: 'workouts', label: 'Workouts', href: '#/' },
    { id: 'programmes', label: 'Programmes', href: '#/programmes' },
  ] as const;
</script>

<nav class="tabs" aria-label="Main sections">
  {#each TABS as t (t.id)}
    {#if t.id === active}
      <!-- The selected tab is the screen's heading; the router moves focus here after navigating. -->
      <h1 class="tab on" tabindex="-1" aria-current="page">{t.label}</h1>
    {:else}
      <a class="tab" href={t.href}>{t.label}</a>
    {/if}
  {/each}
</nav>

<style>
  .tabs { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.75rem; }
  .tab {
    flex: none; margin: 0; padding: 0.25rem 0 0.125rem;
    font-size: clamp(1rem, 4.6vw, 1.375rem); font-weight: 650; line-height: 1.2; white-space: nowrap;
    border-bottom: 3px solid transparent;
  }
  .tab.on { color: var(--text); border-bottom-color: var(--accent); }
  a.tab { color: var(--muted); }
  a.tab:hover { color: var(--text); }
</style>
