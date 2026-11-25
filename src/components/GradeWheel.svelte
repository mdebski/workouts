<script lang="ts">
  import { onMount } from 'svelte';
  import { gradesOf } from '../lib/record.ts';

  /**
   * A wheel of climbing grades, like a phone's time picker: scroll or tap, and the grade on
   * the band in the middle is picked. Nothing is picked until you touch it; `start` only
   * decides where it opens (e.g. last time's grade).
   */
  let { kind, value = $bindable(null), start = null, label }: { kind: 'route' | 'boulder'; value: string | null; start?: string | null; label: string } = $props();

  const ROW = 40; // px, one grade
  const idBase = `grade-${Math.random().toString(36).slice(2, 8)}`;
  const grades = $derived(gradesOf(kind));
  let el = $state<HTMLDivElement>();
  let index = $state(0);
  /** Scrolling only picks once you've touched the wheel, not when it scrolls to where it opens. */
  let armed = false;

  onMount(() => {
    const g = [value, start].find((x): x is string => !!x && grades.includes(x));
    index = g ? grades.indexOf(g) : Math.floor(grades.length / 3);
    // After the sheet has laid out, so the scroll position sticks.
    requestAnimationFrame(() => el?.scrollTo({ top: index * ROW, behavior: 'instant' }));
  });

  function onscroll() {
    if (!el) return;
    index = Math.min(grades.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
    if (armed) value = grades[index];
  }

  function pick(i: number) {
    armed = true;
    index = i;
    value = grades[i];
    el?.scrollTo({ top: i * ROW, behavior: 'smooth' });
  }

  const arm = () => (armed = true);
</script>

<div class="wrap" class:unset={value === null}>
  <div class="wheel" bind:this={el} {onscroll} onpointerdown={arm} ontouchstart={arm} onwheel={arm} role="listbox" tabindex="0" aria-label={label} aria-activedescendant="{idBase}-{index}"
    onkeydown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pick(Math.min(grades.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))); } }}>
    {#each grades as g, i (g)}
      <div class="grade" id="{idBase}-{i}" role="option" tabindex="-1" aria-selected={value === g} class:sel={i === index} onclick={() => pick(i)} onkeydown={() => {}}>{g}</div>
    {/each}
  </div>
</div>

<style>
  /* Three rows tall, snapping so one grade sits on the band in the middle. */
  .wrap { position: relative; }
  .wrap::before { content: ''; position: absolute; inset: 40px 0 auto; height: 40px; border-radius: 10px; background: var(--raise); pointer-events: none; }
  .wheel { position: relative; height: 120px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; padding-block: 40px; overscroll-behavior: contain;
    mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent); }
  .wheel::-webkit-scrollbar { display: none; }
  .wheel:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 10px; }
  .grade { height: 40px; display: grid; place-items: center; scroll-snap-align: center; font-size: 1.125rem; font-weight: 600; color: var(--muted); cursor: pointer; }
  .grade.sel { color: var(--text); font-size: 1.375rem; }
  /* Not picked yet: the grade on the band is only where the wheel opened. */
  .unset .grade.sel { color: var(--muted); }
</style>
