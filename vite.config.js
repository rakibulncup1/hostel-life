import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function readGitValue(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

// Release metadata is embedded at build time. It costs no runtime/API request
// and changes on every production build, including redeploys of the same commit.
const builtAt = new Date().toISOString();
const commit = process.env.VERCEL_GIT_COMMIT_SHA || readGitValue(['rev-parse', 'HEAD']) || 'manual-build';
const releaseId = `${commit.slice(0, 12)}-${builtAt}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __HOSTEL_LIFE_RELEASE__: JSON.stringify({ id: releaseId, builtAt, commit: commit.slice(0, 40) }),
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
