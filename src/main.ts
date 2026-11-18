import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import './app.css';

// The app shell shows a splash until now; the app takes its place.
const target = document.getElementById('app')!;
target.replaceChildren();
const app = mount(App, { target });

// How long this start took, shown in Settings, to tell a slow start apart from a slow device.
// After the first frame (or shortly after mounting, if frames aren't being drawn, e.g. in a hidden tab).
let recorded = false;
const record = () => {
  if (recorded) return;
  recorded = true;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  try {
    sessionStorage.setItem('startup', JSON.stringify({
      html: Math.round(nav?.responseEnd ?? 0),
      script: Math.round(performance.now() - ((window as unknown as { __startedAt?: number }).__startedAt ?? 0)),
      ready: Math.round(performance.now()),
      fromCache: nav ? nav.transferSize === 0 : undefined,
    }));
  } catch {
    // Private mode etc.: nothing to show, nothing lost.
  }
};
requestAnimationFrame(record);
setTimeout(record, 500);

// Register the service worker once the app is on screen, so it doesn't compete with starting up.
addEventListener('load', () => registerSW({ immediate: true }), { once: true });

export default app;
