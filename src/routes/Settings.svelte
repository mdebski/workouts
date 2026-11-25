<script lang="ts">
  import JSON5 from 'json5';
  import { downloadJSON } from '../lib/download.ts';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { db, mergeIn, rememberEmoji, replaceAll, snapshot } from '../lib/state.svelte.ts';
  import { fmtNum, mergeData, migrate, type MergeSummary } from '../lib/core.ts';
  import type { Data } from '../lib/types.ts';
  import { today } from '../lib/dates.ts';
  import { beepVolume, setBeepVolume } from '../lib/timer.svelte.ts';
  import { playSound, type Sound } from '../lib/sounds.ts';

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let message = $state('');
  let error = $state('');
  let steps = $state(db.settings.weightSteps.map(fmtNum).join(', '));
  let persisted = $state<boolean | undefined>();
  navigator.storage?.persisted?.().then((p) => (persisted = p));

  // Backups are plain JSON, a type phones recognise, so every share target (Gmail too) takes them.
  const backupText = () => JSON.stringify(snapshot(), null, 2);

  function exportData() {
    downloadJSON(`workouts-${today()}.json`, snapshot());
    message = 'Backup saved to your downloads.';
    error = '';
  }

  /**
   * The backup as a file the share sheet accepts: JSON, or plain text if a browser
   * refuses that. Import reads the contents, so the name and type don't matter there.
   */
  function shareableFile(): File | undefined {
    const text = backupText();
    const base = `workouts-${today()}`;
    const candidates = [
      new File([text], `${base}.json`, { type: 'application/json' }),
      new File([text], `${base}.txt`, { type: 'text/plain' }),
    ];
    return candidates.find((f) => navigator.canShare?.({ files: [f] }));
  }

  const canShareFiles = typeof navigator.canShare === 'function' && typeof navigator.share === 'function';

  async function shareData() {
    message = error = '';
    const file = shareableFile();
    if (!file) return exportData();
    try {
      await navigator.share({ files: [file], title: 'Workouts backup' });
      message = 'Backup shared. Keep it somewhere outside this phone, like Files, Drive or iCloud.';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // closed the share sheet
      error = "Couldn't open the share sheet. Use Export instead.";
    }
  }

  async function importData(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    message = error = '';
    try {
      // JSON5 reads plain JSON as well as backups saved as .json5 by older versions.
      pending = migrate(JSON5.parse(await file.text()));
      // Dry run on a copy, so the sheet can say what adding would do.
      preview = mergeData(snapshot(), structuredClone(pending));
      fileName = file.name;
      importOpen = true;
    } catch (err) {
      error = `That file couldn't be imported. ${err instanceof Error ? err.message : ''}`;
    }
  }

  let importOpen = $state(false);
  let pending = $state.raw<Data>();
  let preview = $state<MergeSummary>();
  let fileName = $state('');
  const fileSummary = $derived(pending ? `${plural(pending.programmes.length, 'programme')} and ${plural(pending.workouts.length, 'workout')}` : '');

  function doMerge() {
    if (!pending) return;
    const s = mergeIn(pending);
    const parts = [s.programmesAdded && plural(s.programmesAdded, 'programme'), s.workoutsAdded && plural(s.workoutsAdded, 'workout')].filter(Boolean);
    message = parts.length || s.workoutsUpdated
      ? `Added ${parts.join(' and ') || 'nothing new'}${s.workoutsUpdated ? `, and filled in ${plural(s.workoutsUpdated, 'planned workout')} done elsewhere` : ''}.`
      : 'Everything in that backup is already here.';
    close();
  }

  function doReplace() {
    if (!pending) return;
    if (!confirm(`Delete everything on this device and use the ${fileSummary} from the backup instead? This can't be undone.`)) return;
    replaceAll(pending);
    steps = db.settings.weightSteps.map(fmtNum).join(', ');
    message = `Replaced everything with ${fileSummary}.`;
    close();
  }

  function close() {
    importOpen = false;
    pending = undefined;
  }

  const built = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(import.meta.env.VITE_BUILD_TIME));
  /** How long this start of the app took (recorded in main.ts). */
  const startup = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('startup') ?? 'null') as { html: number; ready: number; fromCache?: boolean } | null;
    } catch {
      return null;
    }
  })();

  let updating = $state(false);
  let updateMessage = $state('');

  /** Fetches the latest version, waits for it to install, then reloads into it. Data is untouched. */
  async function updateApp() {
    if (updating) return;
    updating = true;
    updateMessage = '';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.update();
        const next = reg.installing ?? reg.waiting;
        if (next) {
          // Wait for the new version to take over (or give up after 15 s and reload anyway).
          await new Promise<void>((resolve) => {
            const done = () => next.state === 'activated' || next.state === 'redundant';
            if (done()) return resolve();
            next.addEventListener('statechange', () => done() && resolve());
            setTimeout(resolve, 15_000);
          });
        }
      }
      location.reload();
    } catch {
      updating = false;
      updateMessage = "Couldn't check for a new version. Check your connection and try again.";
    }
  }

  let newIcon = $state('');

  /** Adds each emoji typed into the box (several at once work too). */
  function addIcon() {
    const text = newIcon.trim();
    if (!text) return;
    const parts = 'Segmenter' in Intl ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment).filter((s) => s.trim()) : [text];
    for (const p of parts) rememberEmoji(p);
    newIcon = '';
  }

  const SAMPLES: [Sound, string][] = [['tick', 'Countdown'], ['start', 'Start'], ['stop', 'Rest'], ['finish', 'Finished']];
  let volume = $state(Math.round(beepVolume() * 100));
  function saveVolume() {
    setBeepVolume(volume / 100);
    playSound('start', volume / 100);
  }

  function saveSteps() {
    const parsed = steps.split(/[,;\s]+/).map((s) => Number(s.replace(',', '.'))).filter((n) => Number.isFinite(n) && n > 0);
    if (parsed.length) db.settings.weightSteps = parsed.slice(0, 4);
    steps = db.settings.weightSteps.map(fmtNum).join(', ');
  }
</script>

<header class="bar">
  <a class="icon-btn" href="#/" aria-label="Back to agenda"><Icon name="back" /></a>
  <h1 tabindex="-1">Settings</h1>
</header>

<h2>Backup</h2>
<div class="card">
  <p class="muted">Everything lives in this browser only. Export a backup now and then, and before switching phone or browser.</p>
  <div class="row actions">
    {#if canShareFiles}<button class="btn primary share" onclick={shareData}>Share backup</button>{/if}
    <button class="btn grow" onclick={exportData}>Export</button>
    <!-- No accept filter: iOS greys out files whose type it doesn't know, such as older .json5
         backups. The contents are checked on import instead. -->
    <label class="btn grow">Import<input type="file" onchange={importData} hidden /></label>
  </div>
  {#if message}<p class="muted" role="status">{message}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="muted">
    {plural(db.programmes.length, 'programme')} · {plural(db.workouts.length, 'workout')}
    {#if persisted !== undefined} · {persisted ? 'storage is protected' : 'storage may be cleared by the browser if space runs low'}{/if}
  </p>
</div>

<h2>App version</h2>
<div class="card">
  <p class="muted">Version {import.meta.env.VITE_APP_VERSION}, built {built}.</p>
  {#if startup}<p class="muted">This start: page in {startup.html} ms{startup.fromCache ? ' (from the offline copy)' : ''}, app on screen after {startup.ready} ms.</p>{/if}
  <button class="btn wide update" onclick={updateApp} aria-disabled={updating}>{updating ? 'Updating…' : 'Update and reload'}</button>
  {#if updateMessage}<p class="muted" role="status">{updateMessage}</p>{/if}
</div>

<h2>Icons</h2>
<div class="card">
  <p class="muted">Quick choices when picking an icon. Any other emoji you use is added here.</p>
  <ul class="icons">
    {#each db.settings.emoji as e, i (e)}
      <li><span class="icon" aria-hidden="true">{e}</span><button class="icon-btn small" aria-label="Remove {e} from the quick choices" onclick={() => db.settings.emoji.splice(i, 1)}><Icon name="x" size={14} /></button></li>
    {/each}
  </ul>
  <form class="row add-icon" onsubmit={(e) => { e.preventDefault(); addIcon(); }}>
    <label class="grow"><span class="sr">Emoji to add</span><input type="text" bind:value={newIcon} placeholder="Type or pick an emoji" autocomplete="off" /></label>
    <button class="btn" type="submit">Add</button>
  </form>
</div>

<h2>Timer sounds</h2>
<div class="card">
  <label class="field">
    <span>Beep volume <span class="muted">· {volume ? `${volume}%` : 'off'}</span></span>
    <input type="range" min="0" max="100" step="10" bind:value={volume} onchange={saveVolume} />
  </label>
  <div class="sounds">
    {#each SAMPLES as [s, label]}
      <button class="btn small" type="button" onclick={() => playSound(s, volume / 100)} disabled={!volume}>{label}</button>
    {/each}
  </div>
  <p class="muted">Applies on this device only. The phone's own volume still sets the limit.</p>
</div>

<h2>Weights</h2>
<div class="card">
  <label class="field">
    <span>Adjust buttons, in kg</span>
    <input type="text" inputmode="decimal" autocomplete="off" bind:value={steps} onchange={saveSteps} placeholder="1.25, 2.5, 5" />
  </label>
  <p class="muted">Up to four steps, separated by commas.</p>
</div>

<Sheet bind:open={importOpen} label="Import a backup">
  <h2 class="sheet-title">Import {fileName}</h2>
  <p class="muted">The backup has {fileSummary}.</p>
  {#if preview}
    <ul class="what">
      <li>Adds <strong>{plural(preview.programmesAdded, 'programme')}</strong> and <strong>{plural(preview.workoutsAdded, 'workout')}</strong></li>
      {#if preview.workoutsUpdated}<li>Fills in <strong>{plural(preview.workoutsUpdated, 'planned workout')}</strong> that the backup has as done</li>{/if}
      {#if preview.skipped}<li>Leaves <strong>{plural(preview.skipped, 'workout')}</strong> that are already here as they are</li>{/if}
    </ul>
  {/if}
  <button class="btn primary wide" onclick={doMerge}>Add to what's here</button>
  <button class="btn danger wide replace" onclick={doReplace}>Replace everything instead</button>
</Sheet>

<style>
  .sheet-title { color: var(--text); font-size: 1.125rem; margin: 0 0 0.25rem; }
  .what { margin: 0.75rem 0 1rem; padding-left: 1.25rem; display: grid; gap: 0.25rem; }
  .replace { margin-top: 0.5rem; }
  .actions { margin: 0.75rem 0; flex-wrap: wrap; }
  /* The main way to back up gets a row of its own; Export and Import share the next one. */
  .share { flex: 1 0 100%; }
  .update { margin-top: 0.75rem; }
  .sounds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.375rem; }
  .sounds .btn { padding-inline: 0.25rem; }
  .icons { list-style: none; margin: 0.75rem 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.375rem; }
  .icons li { display: flex; align-items: center; gap: 0.125rem; padding: 0 0.125rem 0 0.5rem; border-radius: 99px; background: var(--raise); }
  .icons .icon { font-size: 1.25rem; }
  .icons .icon-btn.small { width: 2rem; height: 2.25rem; color: var(--muted); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .card > p + p { margin-top: 0.5rem; }
</style>
