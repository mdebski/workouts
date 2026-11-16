<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { db } from '../lib/state.svelte.ts';
  import { statusOf } from '../lib/core.ts';
  import { describeRepeat } from '../lib/schedule.ts';
  import { fmtShort, today as todayISO } from '../lib/dates.ts';
  import Sheet from '../components/Sheet.svelte';
  import { go } from '../lib/router.svelte.ts';
  import { encodeProgramme, extractPayload, shareUrl } from '../lib/share.ts';
  import type { Programme } from '../lib/types.ts';

  const today = todayISO();
  const active = $derived(db.programmes.filter((p) => !p.archived));
  const archived = $derived(db.programmes.filter((p) => p.archived));

  function summary(p: Programme): string {
    const { end, start } = p.schedule;
    const ends = end.kind === 'count' ? `${end.n} workouts` : end.kind === 'until' ? `until ${fmtShort(end.date)}` : 'no end';
    return `${describeRepeat(p.schedule)} · from ${fmtShort(start)} · ${ends}`;
  }

  let shared = $state({ id: '', text: '' });

  // Adding from a pasted link: the only way to get a shared programme into an
  // installed iPhone app, where links always open in Safari instead.
  let pasteOpen = $state(false);
  let pasted = $state('');
  let pasteError = $state('');

  function openPaste() {
    pasted = '';
    pasteError = '';
    pasteOpen = true;
  }

  async function pasteFromClipboard() {
    try {
      pasted = await navigator.clipboard.readText();
      pasteError = '';
    } catch {
      pasteError = "Couldn't read the clipboard. Paste the link into the box.";
    }
  }

  function usePasted() {
    const payload = extractPayload(pasted);
    if (!payload) return (pasteError = "That doesn't look like a programme link. Copy the whole link and try again.");
    pasteOpen = false;
    go(`/add/${payload}`);
  }

  async function share(p: Programme) {
    shareLink = '';
    const url = shareUrl(await encodeProgramme($state.snapshot(p) as Programme));
    try {
      if (navigator.share) {
        await navigator.share({ title: `${p.emoji} ${p.name}`, text: `${p.name}: a workout programme`, url });
        shared = { id: p.id, text: '' };
      } else {
        await navigator.clipboard.writeText(url);
        shared = { id: p.id, text: 'Link copied. Anyone who opens it can add this programme.' };
      }
    } catch (e) {
      // Closing the share sheet is not an error.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      shared = { id: p.id, text: "Couldn't share the link. Copy it from here:" };
      shareLink = url;
    }
  }
  let shareLink = $state('');

  function progress(p: Programme): string {
    const mine = db.workouts.filter((w) => w.programmeId === p.id);
    const count = (s: string) => mine.filter((w) => statusOf(w, today) === s).length;
    const left = count('planned') + count('today');
    return `${count('done')} done · ${count('missed')} missed · ${left} to go`;
  }
</script>

<header class="bar">
  <a class="icon-btn" href="#/" aria-label="Back to agenda"><Icon name="back" /></a>
  <h1 tabindex="-1">Programmes</h1>
  <a class="icon-btn add" href="#/p/new" aria-label="New programme"><Icon name="plus" /></a>
</header>

{#snippet card(p: Programme)}
  <div class="card">
    <div class="row">
      <span class="emoji" aria-hidden="true">{p.emoji}</span>
      <div class="grow">
        <strong>{p.name}</strong>
        <p class="muted">{summary(p)}</p>
        <p class="muted">{progress(p)}</p>
      </div>
    </div>
    <div class="row actions">
      <a class="btn small grow" href="#/p/{p.id}/history"><Icon name="table" size={18} /> History</a>
      <a class="btn small grow" href="#/p/{p.id}"><Icon name="edit" size={18} /> Edit</a>
      <button class="btn small grow" onclick={() => share(p)}><Icon name="share" size={18} /> Share</button>
    </div>
    {#if shared.id === p.id && shared.text}
      <p class="muted shared" role="status">{shared.text}</p>
      {#if shareLink}<input type="text" readonly value={shareLink} aria-label="Share link" onfocus={(e) => e.currentTarget.select()} />{/if}
    {/if}
  </div>
{/snippet}

{#each active as p (p.id)}
  {@render card(p)}
{:else}
  <div class="card empty">
    <p><strong>Set up your first programme</strong></p>
    <p class="muted">A programme is a workout you repeat on a schedule. The agenda fills in from it.</p>
    <a class="btn primary" href="#/p/new">New programme</a>
  </div>
{/each}

<button class="btn wide from-link" onclick={openPaste}><Icon name="link" size={18} /> Add from a link</button>

{#if archived.length}
  <h2>Archived</h2>
  {#each archived as p (p.id)}{@render card(p)}{/each}
{/if}

<Sheet bind:open={pasteOpen} label="Add a programme from a link">
  <form onsubmit={(e) => { e.preventDefault(); usePasted(); }}>
    <label class="field">
      <span>Programme link</span>
      <textarea bind:value={pasted} rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#/add/…"></textarea>
    </label>
    {#if pasteError}<p class="error" role="alert">{pasteError}</p>{/if}
    <div class="row">
      {#if navigator.clipboard?.readText}<button type="button" class="btn grow" onclick={pasteFromClipboard}>Paste</button>{/if}
      <button type="submit" class="btn primary grow">Continue</button>
    </div>
  </form>
</Sheet>

<style>
  .from-link { margin-top: 0.5rem; }
  textarea { word-break: break-all; resize: none; }
  .add { color: var(--accent); }
  .actions { margin-top: 0.75rem; flex-wrap: wrap; }
  .shared { margin: 0.5rem 0; }
  .empty { display: grid; gap: 0.5rem; justify-items: start; padding: 1rem; }
</style>
