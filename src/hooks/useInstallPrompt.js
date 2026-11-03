import { useCallback, useEffect, useState } from 'react';

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true,
  );
}

// Capture the install event at module evaluation so a fast browser event is not
// lost before React's first effect is attached. The event is shared by the app.
let deferredPromptEvent = null;
let installedState = detectStandalone();
const subscribers = new Set();
let listenersReady = false;

function publishInstallState() {
  const snapshot = { promptEvent: deferredPromptEvent, installed: installedState };
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

function installBrowserListeners() {
  if (listenersReady || typeof window === 'undefined') return;
  listenersReady = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    if (installedState) return;
    event.preventDefault();
    deferredPromptEvent = event;
    publishInstallState();
  });
  window.addEventListener('appinstalled', () => {
    deferredPromptEvent = null;
    installedState = true;
    publishInstallState();
  });
}

installBrowserListeners();

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(deferredPromptEvent);
  const [installed, setInstalled] = useState(installedState);

  useEffect(() => {
    installBrowserListeners();
    const update = (snapshot) => {
      setPromptEvent(snapshot.promptEvent);
      setInstalled(snapshot.installed);
    };
    subscribers.add(update);
    update({ promptEvent: deferredPromptEvent, installed: installedState });
    return () => subscribers.delete(update);
  }, []);

  const install = useCallback(async () => {
    const currentEvent = deferredPromptEvent || promptEvent;
    if (!currentEvent || installedState) return false;
    deferredPromptEvent = null;
    publishInstallState();
    try {
      await currentEvent.prompt();
      const choice = await currentEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        installedState = true;
        publishInstallState();
        return true;
      }
      return false;
    } catch (error) {
      // Restore no consumed event; the browser requires a fresh gesture/event.
      throw error;
    }
  }, [promptEvent]);

  return { canInstall: Boolean(promptEvent || deferredPromptEvent) && !installed, installed, install };
}
