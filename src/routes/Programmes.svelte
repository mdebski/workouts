<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import MainTabs from '../components/MainTabs.svelte';
  import AddButton from '../components/AddButton.svelte';
  import { db } from '../lib/state.svelte.ts';
  import { statusOf } from '../lib/core.ts';
  import { describeEnd, describeRepeat } from '../lib/schedule.ts';
  import { fmtShort, today as todayISO } from '../lib/dates.ts';
  import Sheet from '../components/Sheet.svelte';
  import { go } from '../lib/router.svelte.ts';
  import { encodeProgramme, extractPayload, shareUrl } from '../lib/share.ts';
  import type { Programme } from '../lib/types.ts';

  const today = todayISO();
  /** A programme's end: the date of its last workout (or its start, if it has none yet). */
  const endOf = (p: Programme) =>
    db.workouts.reduce((last, w) => (w.programmeId === p.id && (w.scheduledDate ?? w.date) > last ? (w.scheduledDate ?? w.date) : last), p.schedule.start);
  // Newest first: the programme that ends latest comes on top.
  const byEnd = (list: Programme[]) => list.map((p) => [p, endOf(p)] as const).sort((a, b) => b[1].localeCompare(a[1]) || a[0].name.localeCompare(b[0].name)).map(([p]) => p);
  const active = $derived(byEnd(db.programmes.filter((p) => !p.archived)));
  const archived = $derived(byEnd(db.programmes.filter((p) => p.archived)));

  function summary(p: Programme): string {
    return `${describeRepeat(p.schedule)} · from ${fmtShort(p.schedule.start)} · ${describeEnd(p.schedule)}`;
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

  // Share links are built ahead of time. Building one takes a moment (it is compressed),
  // and Safari only opens the share sheet if it's asked straight away when the button
  // is tapped, so there must be no waiting between the tap and navigator.share().
  let links = $state<Record<string, string>>({});
  $effect(() => {
    for (const p of db.programmes) {
      const snapshot = $state.snapshot(p) as Programme;
      encodeProgramme(snapshot).then((payload) => (links[p.id] = shareUrl(payload)));
    }
  });

  async function share(p: Programme) {
    shareLink = '';
    const url = links[p.id] ?? shareUrl(await encodeProgramme($state.snapshot(p) as Programme));
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
    const partial = count('partial');
    return `${count('done')} done${partial ? ` · ${partial} partly done` : ''} · ${count('missed')} missed · ${left} to go`;
  }
</script>

<header class="bar main">
  <MainTabs active="programmes" />
  <AddButton />
  <a class="icon-btn" href="#/search" aria-label="Search exercises"><Icon name="search" /></a>
  <a class="icon-btn" href="#/settings" aria-label="Settings"><Icon name="settings" /></a>
</header>

{#snippet card(p: Programme)}
  <div class="card prog">
    <div class="row">
      <span class="emoji" aria-hidden="true">{p.emoji}</span>
      <div class="grow">
        <!-- The name's link covers the whole card, so tapping anywhere opens the history;
             the buttons sit above it and keep their own actions. -->
        <a class="open" href="#/p/{p.id}/history"><strong>{p.name}</strong></a>
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

<button class="btn wide from-link" onclick={openPaste}><Icon name="link" size={18} /> Add from a link</button>

{#each active as p (p.id)}
  {@render card(p)}
{:else}
  <div class="card empty">
    <p><strong>Set up your first programme</strong></p>
    <p class="muted">A programme is a workout you repeat on a schedule. The agenda fills in from it.</p>
    <a class="btn primary" href="#/p/new">New programme</a>
  </div>
{/each}


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
      {#if 'clipboard' in navigator}<button type="button" class="btn grow" onclick={pasteFromClipboard}>Paste</button>{/if}
      <button type="submit" class="btn primary grow">Continue</button>
    </div>
  </form>
</Sheet>

<style>
  .prog { position: relative; cursor: pointer; }
  .prog:hover { background: var(--raise); }
  .open::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
  .open:focus-visible { outline: none; }
  .prog:has(.open:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .prog .actions, .prog .shared, .prog input { position: relative; z-index: 1; }
  .from-link { margin-bottom: 0.75rem; }
  textarea { word-break: break-all; resize: none; }
  .actions { margin-top: 0.75rem; flex-wrap: wrap; }
  .shared { margin: 0.5rem 0; }
  .empty { display: grid; gap: 0.5rem; justify-items: start; padding: 1rem; }
</style>
