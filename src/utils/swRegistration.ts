export interface SwUpdateSnapshot {
  updateAvailable: boolean;
  updating: boolean;
  checking: boolean;
  registrationReady: boolean;
}

type SwListener = (snapshot: SwUpdateSnapshot) => void;

const listeners = new Set<SwListener>();
let registeredOnce = false;
let registrationRef: ServiceWorkerRegistration | null = null;
let reloadPendingFromUserAction = false;
let lastCheckAt = 0;

let snapshot: SwUpdateSnapshot = {
  updateAvailable: false,
  updating: false,
  checking: false,
  registrationReady: false,
};

function notifyListeners() {
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function updateSnapshot(patch: Partial<SwUpdateSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  notifyListeners();
}

export function getSwUpdateSnapshot(): SwUpdateSnapshot {
  return snapshot;
}

export function subscribeSwUpdateState(listener: SwListener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

function inspectRegistration(reg: ServiceWorkerRegistration) {
  registrationRef = reg;
  updateSnapshot({ registrationReady: true });

  if (reg.waiting && navigator.serviceWorker.controller) {
    updateSnapshot({ updateAvailable: true });
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (
        installing.state === 'installed' &&
        navigator.serviceWorker.controller
      ) {
        updateSnapshot({ updateAvailable: true });
      }
    });
  });
}

export async function checkForSwUpdates(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  updateSnapshot({ checking: true });
  try {
    const reg =
      registrationRef || (await navigator.serviceWorker.getRegistration('/'));
    if (!reg) return false;
    registrationRef = reg;
    lastCheckAt = Date.now();
    await reg.update();
    const hasWaiting = Boolean(reg.waiting && navigator.serviceWorker.controller);
    if (hasWaiting) {
      updateSnapshot({ updateAvailable: true });
    }
    return hasWaiting;
  } catch {
    return false;
  } finally {
    updateSnapshot({ checking: false });
  }
}

export async function applySafeSwUpdate(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  try {
    const reg =
      registrationRef || (await navigator.serviceWorker.getRegistration('/'));
    const waiting = reg?.waiting;
    if (!waiting) {
      updateSnapshot({ updateAvailable: false });
      return;
    }
    reloadPendingFromUserAction = true;
    updateSnapshot({ updating: true });
    waiting.postMessage({ type: 'BLINKUPZ_SKIP_WAITING' });
  } catch {
    reloadPendingFromUserAction = false;
    updateSnapshot({ updating: false });
  }
}

export function registerAppServiceWorker(): void {
  if (
    registeredOnce ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }
  registeredOnce = true;

  let hasReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only when triggered deliberately by the user clicking "Update Now"
    if (reloadPendingFromUserAction && !hasReloaded) {
      hasReloaded = true;
      window.location.reload();
    }
  });

  const registerNow = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        inspectRegistration(reg);
        lastCheckAt = Date.now();
        reg.update().catch(() => {});
      })
      .catch(() => {
        // Non-fatal in unsupported/restricted environments
      });
  };

  if (document.readyState === 'complete') {
    registerNow();
  } else {
    window.addEventListener('load', registerNow, { once: true });
  }

  // Safe background update checks on focus (at most every 10 min) and every 30 min when online
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      navigator.onLine &&
      Date.now() - lastCheckAt > 10 * 60_000
    ) {
      void checkForSwUpdates();
    }
  });

  window.setInterval(() => {
    if (navigator.onLine) {
      void checkForSwUpdates();
    }
  }, 30 * 60_000);
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
