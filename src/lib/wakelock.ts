/** Keeps the screen on until the returned function is called. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let released = false;

  const request = async () => {
    if (released || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (e.g. battery saver). The timer still works, the screen just may dim.
    }
  };

  // The lock is dropped whenever the page is hidden, so take it again on return.
  const onVisible = () => void request();
  document.addEventListener('visibilitychange', onVisible);
  void request();

  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => {});
  };
}
