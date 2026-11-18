import { tick } from 'svelte';

export interface Route {
  name: 'agenda' | 'workout' | 'programmes' | 'edit-programme' | 'edit-workout' | 'history' | 'settings' | 'add' | 'search' | 'add-activity';
  id?: string;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const [a, b, c] = path.split('/');
  const query = new URLSearchParams(qs);
  if (a === 'w' && b) return { name: c === 'edit' ? 'edit-workout' : 'workout', id: b, query };
  if (a === 'p' && b) return { name: c === 'history' ? 'history' : 'edit-programme', id: b, query };
  if (a === 'programmes') return { name: 'programmes', query };
  if (a === 'add' && b) return { name: 'add', id: b, query };
  if (a === 'a' && b === 'new') return { name: 'add-activity', query };
  if (a === 'search') return { name: 'search', query };
  if (a === 'settings') return { name: 'settings', query };
  return { name: 'agenda', query };
}

export const router = $state<{ route: Route }>({ route: parse(location.hash) });

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where each screen was scrolled to when you left it, so a screen can put you back there. */
export const scrollMemory = new Map<Route['name'], number>();

async function apply(): Promise<void> {
  scrollMemory.set(router.route.name, scrollY);
  router.route = parse(location.hash);
  // Start each screen at the top (the agenda then restores its place, or scrolls to today).
  scrollTo(0, 0);
  await tick();
  // View transitions don't manage focus: move it to the new screen's heading.
  document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
}

addEventListener('hashchange', () => {
  if (!document.startViewTransition || reducedMotion() || document.visibilityState !== 'visible') return void apply();

  // The update must never depend on the transition: if the browser can't capture a
  // frame (page in the background, a transition already running) apply it anyway.
  let applied = false;
  const run = () => {
    if (applied) return;
    applied = true;
    return apply();
  };
  const transition = document.startViewTransition(run);
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
  setTimeout(() => {
    if (applied) return;
    transition.skipTransition();
    void run();
  }, 250);
});

export const go = (path: string) => {
  location.hash = path;
};
