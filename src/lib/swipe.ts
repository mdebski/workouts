// A horizontal swipe anywhere in an element. Built on touch events rather than
// pointer events, because the browser cancels pointer events as soon as it starts
// scrolling, and it never blocks scrolling: vertical scrolling keeps working.

export interface SwipeHandlers {
  /** Finger moved right to left: go to the next thing. */
  left?: () => void;
  /** Finger moved left to right: go to the previous thing. */
  right?: () => void;
}

const MIN_DISTANCE = 70; // px
const MAX_TIME = 700; // ms
const EDGE = 24; // px; swipes from the screen edge belong to the system (e.g. back on iOS)
/** Places where a sideways drag means something else. */
const IGNORE = 'input, textarea, select, dialog, [data-noswipe]';

export function swipe(node: HTMLElement, handlers: SwipeHandlers) {
  let current = handlers;
  let start: { x: number; y: number; t: number } | undefined;

  const scrollsSideways = (el: Element | null): boolean => {
    for (; el && el !== node; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };

  function onStart(e: TouchEvent) {
    start = undefined;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const target = e.target as Element;
    if (t.clientX < EDGE || t.clientX > innerWidth - EDGE) return;
    if (target.closest(IGNORE) || scrollsSideways(target)) return;
    start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
  }

  function onEnd(e: TouchEvent) {
    if (!start || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = e.timeStamp - start.t < MAX_TIME;
    start = undefined;
    // Clearly sideways: long enough, and at least twice as horizontal as vertical.
    if (!quick || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) return;
    if (document.querySelector('dialog[open]')) return;
    (dx < 0 ? current.left : current.right)?.();
  }

  const onCancel = () => (start = undefined);

  node.addEventListener('touchstart', onStart, { passive: true });
  node.addEventListener('touchend', onEnd, { passive: true });
  node.addEventListener('touchcancel', onCancel, { passive: true });

  return {
    update(next: SwipeHandlers) {
      current = next;
    },
    destroy() {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onCancel);
    },
  };
}
