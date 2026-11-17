<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { ui } from './lib/state.svelte.ts';
  import Agenda from './routes/Agenda.svelte';
  import Workout from './routes/Workout.svelte';
  import Programmes from './routes/Programmes.svelte';
  import Editor from './routes/Editor.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import AddProgramme from './routes/AddProgramme.svelte';
  import Search from './routes/Search.svelte';

  const route = $derived(router.route);
</script>

{#if ui.saveError}<p class="save-error" role="alert">{ui.saveError}</p>{/if}

<main>
  {#if route.name === 'workout'}
    {#key route.id}<Workout id={route.id!} />{/key}
  {:else if route.name === 'edit-workout'}
    {#key route.id}<Editor kind="workout" id={route.id!} date={route.query.get('date') ?? undefined} />{/key}
  {:else if route.name === 'edit-programme'}
    {#key route.id}<Editor kind="programme" id={route.id!} />{/key}
  {:else if route.name === 'history'}
    {#key route.id}<History id={route.id!} />{/key}
  {:else if route.name === 'programmes'}
    <Programmes />
  {:else if route.name === 'add'}
    {#key route.id}<AddProgramme payload={route.id!} />{/key}
  {:else if route.name === 'search'}
    <!-- Re-created when a link brings a different query; typing only rewrites the address, so it doesn't. -->
    {#key route.query.get('q')}<Search />{/key}
  {:else if route.name === 'settings'}
    <Settings />
  {:else}
    <Agenda />
  {/if}
</main>

<style>
  .save-error { background: var(--bad); color: var(--bad-ink); padding: 0.5rem 1rem; font-weight: 600; }
</style>
