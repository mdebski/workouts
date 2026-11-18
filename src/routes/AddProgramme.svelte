<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { formatDuration } from '../lib/duration.ts';
  import { db, saveProgramme } from '../lib/state.svelte.ts';
  import { describe } from '../lib/core.ts';
  import { describeEnd, describeRepeat } from '../lib/schedule.ts';
  import { fmtShort, isISODate, today as todayISO } from '../lib/dates.ts';
  import { go } from '../lib/router.svelte.ts';
  import { decodeProgramme, isIOSBrowserTab } from '../lib/share.ts';
  import type { Programme } from '../lib/types.ts';

  let { payload }: { payload: string } = $props();

  const today = todayISO();
  let programme = $state<Programme>();
  let failed = $state(false);
  let error = $state('');

  // In Safari on iPhone the home-screen app can't be reached by a link, so offer to carry it over by hand.
  const showAppHint = isIOSBrowserTab();
  let copyStatus = $state('');
  let showLink = $state(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copyStatus = 'Link copied. Open the app, go to Programmes, and choose Add from a link.';
    } catch {
      copyStatus = "Couldn't copy automatically. Copy the link below.";
      showLink = true;
    }
  }

  // The parent re-creates this screen for each link, so the payload is read once.
  decodeProgramme(untrack(() => payload), today).then(
    (p) => (programme = p),
    () => (failed = true),
  );

  const duplicate = $derived(programme ? db.programmes.some((p) => p.name === programme!.name) : false);
  const ends = $derived(programme ? describeEnd(programme.schedule) : '');

  function add() {
    if (!programme) return;
    const { start, end } = programme.schedule;
    if (!isISODate(start)) return (error = 'Pick a start date.');
    if (end.kind === 'until' && end.date < start) return (error = `This programme ends on ${fmtShort(end.date)}. Pick an earlier start date.`);
    saveProgramme($state.snapshot(programme) as Programme);
    // Replace the link in history so Back doesn't offer to add it again.
    history.replaceState(null, '', '#/programmes');
    go('/');
  }
</script>

<header class="bar">
  <a class="icon-btn" href="#/" aria-label="Close without adding"><Icon name="x" /></a>
  <h1 tabindex="-1">Add this programme?</h1>
</header>

{#if failed}
  <div class="card">
    <p><strong>This link doesn't work</strong></p>
    <p class="muted">It may have been cut short when it was copied. Ask for it to be shared again.</p>
    <a class="btn" href="#/">Go to your agenda</a>
  </div>
{:else if programme}
  <p class="muted lead">Someone shared a programme with you. Nothing is added until you say so.</p>

  <div class="card">
    <div class="row">
      <span class="emoji" aria-hidden="true">{programme.emoji}</span>
      <div class="grow">
        <strong>{programme.name}</strong>
        <p class="muted">{describeRepeat(programme.schedule)} · {ends}</p>
      </div>
    </div>
    {#if programme.description}<p class="muted desc">{programme.description}</p>{/if}
  </div>

  <h2>Exercises</h2>
  <ul class="card list">
    {#each programme.items as item (item.id)}
      {#if item.type === 'superset'}
        <li class="ss">
          <span class="muted">Superset · {item.rounds} rounds</span>
          <ul>
            {#each item.items as ex (ex.id)}<li>{#if ex.type === 'rest'}<strong>Rest</strong> <span class="muted">{formatDuration(ex.seconds)}</span>{:else}<strong>{ex.name}</strong> <span class="muted">{describe(ex, true)}</span>{/if}</li>{/each}
          </ul>
        </li>
      {:else if item.type === 'rest'}
        <li><strong>Rest</strong> <span class="muted">{formatDuration(item.seconds)}</span></li>
      {:else}
        <li><strong>{item.name}</strong> <span class="muted">{describe(item)}</span></li>
      {/if}
    {:else}
      <li class="muted">No exercises.</li>
    {/each}
  </ul>

  <label class="field start"><span>Start on</span><input type="date" min={today} bind:value={programme.schedule.start} /></label>
  {#if duplicate}<p class="muted note">You already have a programme called "{programme.name}". This adds a second one.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if showAppHint}
    <div class="card hint">
      <p><strong>Using the app from your home screen?</strong></p>
      <p class="muted">It keeps its own data, separate from Safari. To add this programme there, copy the link, open the app, go to Programmes, and choose Add from a link.</p>
      <button class="btn" onclick={copyLink}>Copy link</button>
      {#if copyStatus}<p class="muted" role="status">{copyStatus}</p>{/if}
      {#if showLink}<input type="text" readonly value={location.href} aria-label="Programme link" onfocus={(e) => e.currentTarget.select()} />{/if}
    </div>
  {/if}

  <div class="row">
    <a class="btn grow" href="#/">Not now</a>
    <button class="btn primary grow" onclick={add}>Add programme</button>
  </div>
{:else}
  <p class="muted lead" role="status">Reading the link…</p>
{/if}

<style>
  .lead { margin: 0 0.25rem 0.75rem; }
  .desc { margin-top: 0.5rem; }
  .card { display: grid; gap: 0.5rem; }
  .list { list-style: none; margin: 0 0 0.5rem; padding: 0.75rem; }
  .list ul { list-style: none; margin: 0.25rem 0 0; padding-left: 0.75rem; border-left: 2px dashed #7f77dd; display: grid; gap: 0.25rem; }
  .start { margin-top: 1rem; }
  .note { margin-bottom: 0.75rem; }
  .hint { margin-bottom: 0.75rem; justify-items: start; border: 2px solid var(--line); }
</style>
