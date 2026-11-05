import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function readGitValue(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}


function publicDocumentAliases() {
  const aliases = new Map([
    ['/', '/about.html'],
    ['/about', '/about.html'],
    ['/privacy-policy', '/privacy-policy.html'],
    ['/terms-of-service', '/terms-of-service.html'],
  ]);
  const rewriteRequest = (req, _res, next) => {
    if (typeof req.url === 'string') {
      const queryIndex = req.url.indexOf('?');
      const pathname = queryIndex >= 0 ? req.url.slice(0, queryIndex) : req.url;
      const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
      const target = aliases.get(pathname);
      if (target) req.url = `${target}${query}`;
    }
    next();
  };
  return {
    name: 'hostel-life-public-document-aliases',
    configureServer(server) { server.middlewares.use(rewriteRequest); },
    configurePreviewServer(server) { server.middlewares.use(rewriteRequest); },
  };
}

// Release metadata is embedded at build time. A commit is one release even when
// Vercel rebuilds/redeploys it; manual builds retain a timestamp fallback.
const builtAt = new Date().toISOString();
const commit = process.env.VERCEL_GIT_COMMIT_SHA || readGitValue(['rev-parse', 'HEAD']) || 'manual-build';
const releaseId = commit === 'manual-build' ? `manual-${builtAt}` : commit.slice(0, 12);

export default defineConfig({
  plugins: [publicDocumentAliases(), react()],
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
