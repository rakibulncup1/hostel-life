export const APP_BACKGROUND_EXIT_KEY = 'hostel-life-background-exit-v1';

export function resolveLaunchPath(pathname, backgroundExitMarkerPresent) {
  const safePath = typeof pathname === 'string' && pathname ? pathname : '/app/dashboard';
  return backgroundExitMarkerPresent && safePath.startsWith('/app/')
    ? '/app/dashboard'
    : safePath;
}
