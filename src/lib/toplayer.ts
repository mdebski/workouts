// Closing a <dialog> with an exit animation. Chromium can transition `display` and
// `overlay`; elsewhere we hold the dialog open with [data-closing] until the CSS
// transition has finished.

let displayTransition: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (displayTransition !== undefined) return displayTransition;
  if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) return false;
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = 'none';
  displayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return displayTransition;
}

const supportsTopLayerExit = () => !!window.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay();

export async function closeDialog(el: HTMLDialogElement): Promise<void> {
  if (!el.open) return;
  if (!supportsTopLayerExit()) {
    el.setAttribute('data-closing', '');
    const animations = el.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([Promise.allSettled(animations.map((a) => a.finished)), new Promise((r) => setTimeout(r, 2000))]);
    }
    if (!el.hasAttribute('data-closing')) return;
    el.removeAttribute('data-closing');
  }
  el.close();
}

/** Light dismiss for browsers without <dialog closedby>. */
export function isBackdropClick(el: HTMLDialogElement, e: MouseEvent): boolean {
  if ('closedBy' in HTMLDialogElement.prototype) return false;
  if (e.target !== el) return false;
  const r = el.getBoundingClientRect();
  return !(r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right);
}
