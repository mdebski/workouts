<script lang="ts">
  import { go, router } from './lib/router.svelte.ts';
  import { db, getWorkout, ui } from './lib/state.svelte.ts';
  import { neighbours } from './lib/core.ts';
  import { swipe, type SwipeHandlers } from './lib/swipe.ts';
  import Agenda from './routes/Agenda.svelte';
  import Workout from './routes/Workout.svelte';
  import Programmes from './routes/Programmes.svelte';
  import Editor from './routes/Editor.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import AddProgramme from './routes/AddProgramme.svelte';
  import Search from './routes/Search.svelte';

  const route = $derived(router.route);

  // Swipe left / right: between the two main tabs, and between workouts of the same name.
  // Swipe up at the bottom of a workout: back to the agenda.
  const gestures = $derived.by((): SwipeHandlers => {
    if (route.name === 'agenda') return { left: () => go('/programmes') };
    if (route.name === 'programmes') return { right: () => go('/') };
    if (route.name === 'workout') {
      const w = getWorkout(route.id!);
      const { prev, next } = w ? neighbours(db, w) : {};
      return { left: next && (() => go(`/w/${next.id}`)), right: prev && (() => go(`/w/${prev.id}`)), up: () => go('/') };
    }
    return {};
  });
</script>

{#if ui.saveError}<p class="save-error" role="alert">{ui.saveError}</p>{/if}

<main use:swipe={gestures}>
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
