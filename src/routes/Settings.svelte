<script lang="ts">
  import JSON5 from 'json5';
  import Icon from '../components/Icon.svelte';
  import { db, replaceAll, snapshot } from '../lib/state.svelte.ts';
  import { fmtNum, migrate } from '../lib/core.ts';
  import { today } from '../lib/dates.ts';

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let message = $state('');
  let error = $state('');
  let steps = $state(db.settings.weightSteps.map(fmtNum).join(', '));
  let persisted = $state<boolean | undefined>();
  navigator.storage?.persisted?.().then((p) => (persisted = p));

  function exportData() {
    const blob = new Blob([JSON5.stringify(snapshot(), null, 2)], { type: 'application/json5' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workouts-${today()}.json5`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    message = 'Backup saved to your downloads.';
    error = '';
  }

  async function importData(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    message = error = '';
    try {
      const data = migrate(JSON5.parse(await file.text()));
      const summary = `${plural(data.programmes.length, 'programme')} and ${plural(data.workouts.length, 'workout')}`;
      if (!confirm(`Replace everything on this device with ${summary} from the backup? This can't be undone.`)) return;
      replaceAll(data);
      steps = db.settings.weightSteps.map(fmtNum).join(', ');
      message = `Imported ${summary}.`;
    } catch (err) {
      error = `That file couldn't be imported. ${err instanceof Error ? err.message : ''}`;
    }
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
    <button class="btn grow" onclick={exportData}>Export</button>
    <label class="btn grow">Import<input type="file" accept=".json5,.json,application/json" onchange={importData} hidden /></label>
  </div>
  {#if message}<p class="muted" role="status">{message}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="muted">
    {plural(db.programmes.length, 'programme')} · {plural(db.workouts.length, 'workout')}
    {#if persisted !== undefined} · {persisted ? 'storage is protected' : 'storage may be cleared by the browser if space runs low'}{/if}
  </p>
</div>

<h2>Weights</h2>
<div class="card">
  <label class="field">
    <span>Adjust buttons, in kg</span>
    <input type="text" inputmode="decimal" autocomplete="off" bind:value={steps} onchange={saveSteps} placeholder="1.25, 2.5, 5" />
  </label>
  <p class="muted">Up to four steps, separated by commas.</p>
</div>

<style>
  .actions { margin: 0.75rem 0; }
  .card > p + p { margin-top: 0.5rem; }
</style>
