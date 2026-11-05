/* One-tap PWA install from the public About page when the browser supports it. */
(() => {
  let deferredInstallPrompt = null;
  let installed = Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    navigator.standalone === true
  );

  window.addEventListener('beforeinstallprompt', (event) => {
    if (installed) return;
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredInstallPrompt = null;
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-pwa-install-link]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || installed || !deferredInstallPrompt) return;

    // prompt() must be invoked synchronously during this user click.
    event.preventDefault();
    const installEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;

    try {
      const promptResult = installEvent.prompt();
      Promise.resolve(promptResult)
        .then(async (result) => result || await installEvent.userChoice)
        .then((choice) => {
          if (choice?.outcome === 'accepted') installed = true;
        })
        .catch(() => {
          window.location.assign(link.href);
        });
    } catch {
      window.location.assign(link.href);
    }
  });
})();
