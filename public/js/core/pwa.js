/**
 * Progressive-web-app glue: registers the service worker and surfaces the
 * install prompt.
 *
 * All of it is optional - the app works identically without a worker, so every
 * failure here is swallowed rather than surfaced.
 */

const INSTALL_DISMISSED_KEY = 'thewait.installDismissed';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Registering after load keeps the worker off the critical path.
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.info('[the-wait] service worker not registered:', error.message);
    });
  });

  // A new worker took over - reload once so the fresh shell is in play.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/**
 * Wires up the "Add to home screen" affordance. Chrome fires
 * `beforeinstallprompt`; iOS Safari never does, so the caller is told the
 * platform needs the manual Share-sheet instructions instead.
 */
export function watchInstallPrompt({ onAvailable }) {
  let deferredPrompt = null;

  const dismissed = (() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  })();

  const alreadyInstalled =
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if (dismissed || alreadyInstalled) return;

  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;

    onAvailable({
      manual: false,
      async install() {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        return outcome === 'accepted';
      },
      dismiss: rememberDismissal
    });
  });

  // iOS: no event exists, so offer the instructions directly.
  const isIosSafari = /iP(hone|ad|od)/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
  if (isIosSafari) {
    onAvailable({ manual: true, install: async () => false, dismiss: rememberDismissal });
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    // Nothing to do - the banner simply reappears next visit.
  }
}
