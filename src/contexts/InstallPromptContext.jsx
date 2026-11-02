import { createContext, useContext } from 'react';

const InstallPromptContext = createContext({
  canInstall: false,
  installed: false,
  install: async () => false,
});

export function InstallPromptProvider({ value, children }) {
  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}

export function useInstallPromptContext() {
  return useContext(InstallPromptContext);
}
