export function registerAppServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // Allow seamless updates when a new service worker takes control without interrupting active uploads;
    // static assets from Vite use content hashes cleanly.
    reloading = false;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.update().catch(() => {});

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage({ type: 'BLINKUPZ_SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {
        // Non-fatal in restricted/insecure contexts
      });
  });
}

export async function postServiceWorkerMessage(
  payload: Record<string, unknown>
): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const target = reg?.active || navigator.serviceWorker.controller;
    target?.postMessage(payload);
  } catch {
    // Ignore SW postMessage failure
  }
}
