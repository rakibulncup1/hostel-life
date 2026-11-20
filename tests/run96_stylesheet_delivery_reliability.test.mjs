import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swSource = fs.readFileSync(path.join(projectRoot, 'public/service-worker.js'), 'utf8');
const verifier = path.join(projectRoot, 'scripts/verify-stylesheet-integrity.mjs');

function makeCacheStorage(seed = {}) {
  const stores = new Map();
  const origin = 'https://hostellife.test';
  const keyOf = (request) => typeof request === 'string'
    ? new URL(request, origin).href
    : request.url;

  for (const [cacheName, entries] of Object.entries(seed)) {
    stores.set(cacheName, new Map(entries.map(([url, response]) => [keyOf(url), response.clone()])));
  }

  function makeCache(cacheName) {
    const store = stores.get(cacheName);
    return {
      async match(request) {
        const response = store.get(keyOf(request));
        return response ? response.clone() : undefined;
      },
      async put(request, response) {
        store.set(keyOf(request), response.clone());
      },
      async keys() {
        return [...store.keys()].map((url) => new Request(url));
      },
      async addAll(requests) {
        for (const request of requests) {
          const url = new URL(request, origin).href;
          const response = await globalThis.fetch(url);
          if (!response.ok) throw new Error(`Failed to add ${url}`);
          store.set(url, response.clone());
        }
      },
    };
  }

  return {
    async open(cacheName) {
      if (!stores.has(cacheName)) stores.set(cacheName, new Map());
      return makeCache(cacheName);
    },
    async keys() { return [...stores.keys()]; },
    async delete(cacheName) { return stores.delete(cacheName); },
    async match(request) {
      for (const cacheName of stores.keys()) {
        const response = stores.get(cacheName).get(keyOf(request));
        if (response) return response.clone();
      }
      return undefined;
    },
    _stores: stores,
  };
}

function bootServiceWorker({ caches, fetchImpl }) {
  const listeners = new Map();
  const self = {
    location: { origin: 'https://hostellife.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  vm.runInNewContext(swSource, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Request,
    Response,
    Promise,
    Set,
    console,
  });
  return listeners;
}

function runFetchHandler(listener, request) {
  let responsePromise;
  listener({ request, respondWith(value) { responsePromise = Promise.resolve(value); } });
  assert.ok(responsePromise, 'service worker should call respondWith for this request');
  return responsePromise;
}

test('current source has no missing CSS imports, public stylesheet links, or CSS url() assets', () => {
  const result = spawnSync(process.execPath, [verifier, '--source'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /stylesheet-integrity:source\] OK/);
});

test('source integrity checker fails when a linked public CSS file is absent from the repository', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-life-css-source-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'public/landing-assets'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'index.html'), '<script type="module" src="/src/main.jsx"></script>');
  fs.writeFileSync(path.join(temp, 'src/main.jsx'), "import './global.css';\n");
  fs.writeFileSync(path.join(temp, 'src/global.css'), 'body { color: black; }');
  fs.writeFileSync(path.join(temp, 'public/about.html'), '<link rel="stylesheet" href="/landing-assets/about.css">');
  fs.writeFileSync(path.join(temp, 'public/landing-assets/about.css'), 'body { color: black; }');

  const good = spawnSync(process.execPath, [verifier, '--source', '--root', temp], { encoding: 'utf8' });
  assert.equal(good.status, 0, `${good.stdout}\n${good.stderr}`);

  fs.unlinkSync(path.join(temp, 'public/landing-assets/about.css'));
  const bad = spawnSync(process.execPath, [verifier, '--source', '--root', temp], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(`${bad.stdout}\n${bad.stderr}`, /missing stylesheet/);
});

test('dist integrity checker verifies the CSS and module files that Vite actually emitted', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hostel-life-css-dist-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dist = path.join(temp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'landing-assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>');
  fs.writeFileSync(path.join(dist, 'assets/app.css'), 'body { color: black; }');
  fs.writeFileSync(path.join(dist, 'assets/app.js'), '');
  fs.writeFileSync(path.join(dist, 'about.html'), '<link rel="stylesheet" href="/landing-assets/about.css">');
  fs.writeFileSync(path.join(dist, 'landing-assets/about.css'), 'body { color: black; }');

  const good = spawnSync(process.execPath, [verifier, '--dist', '--root', temp], { encoding: 'utf8' });
  assert.equal(good.status, 0, `${good.stdout}\n${good.stderr}`);

  fs.unlinkSync(path.join(dist, 'assets/app.css'));
  const bad = spawnSync(process.execPath, [verifier, '--dist', '--root', temp], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(`${bad.stdout}\n${bad.stderr}`, /missing stylesheet/);
});

test('service worker fetches CSS from network first and caches a valid stylesheet response', async () => {
  let networkCalls = 0;
  const caches = makeCacheStorage();
  const listeners = bootServiceWorker({
    caches,
    fetchImpl: async () => {
      networkCalls += 1;
      return new Response('body { color: navy; }', { headers: { 'content-type': 'text/css; charset=utf-8' } });
    },
  });
  const request = new Request('https://hostellife.test/landing-assets/public-experience.css');
  const response = await runFetchHandler(listeners.get('fetch'), request);
  assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.match(await response.text(), /color: navy/);
  assert.equal(networkCalls, 1);
  assert.ok(await (await caches.open('hostel-life-shell-v22')).match(request));
});

test('network failure returns the last known-good CSS instead of an unstyled page', async () => {
  const url = 'https://hostellife.test/landing-assets/about.css';
  const cachedCss = new Response('body { color: darkgreen; }', { headers: { 'content-type': 'text/css' } });
  const caches = makeCacheStorage({ 'hostel-life-shell-v22': [[url, cachedCss]] });
  const listeners = bootServiceWorker({ caches, fetchImpl: async () => { throw new Error('temporary network failure'); } });
  const response = await runFetchHandler(listeners.get('fetch'), new Request(url));
  assert.equal(response.headers.get('content-type'), 'text/css');
  assert.match(await response.text(), /darkgreen/);
});

test('an HTML rewrite/error response is never cached as CSS and cannot replace a cached stylesheet', async () => {
  const url = 'https://hostellife.test/landing-assets/run95-theme.css';
  const cachedCss = new Response('body { color: purple; }', { headers: { 'content-type': 'text/css' } });
  const caches = makeCacheStorage({ 'hostel-life-shell-v22': [[url, cachedCss]] });
  const listeners = bootServiceWorker({
    caches,
    fetchImpl: async () => new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } }),
  });
  const response = await runFetchHandler(listeners.get('fetch'), new Request(url));
  assert.equal(response.headers.get('content-type'), 'text/css');
  assert.match(await response.text(), /purple/);
  const persisted = await (await caches.open('hostel-life-shell-v22')).match(url);
  assert.equal(persisted.headers.get('content-type'), 'text/css');
});

test('service worker upgrade migrates cached CSS but leaves unrelated origin caches untouched', async () => {
  const url = 'https://hostellife.test/assets/old-app.css';
  const oldCss = new Response('body { background: white; }', { headers: { 'content-type': 'text/css' } });
  const caches = makeCacheStorage({
    'hostel-life-shell-v21': [[url, oldCss]],
    'another-app-cache': [['https://hostellife.test/other.json', new Response('{}')]],
  });
  const listeners = bootServiceWorker({ caches, fetchImpl: async () => { throw new Error('not expected'); } });
  let activation;
  listeners.get('activate')({ waitUntil(value) { activation = Promise.resolve(value); } });
  await activation;

  const names = await caches.keys();
  assert.ok(names.includes('hostel-life-shell-v22'));
  assert.ok(names.includes('another-app-cache'));
  assert.ok(!names.includes('hostel-life-shell-v21'));
  const migrated = await (await caches.open('hostel-life-shell-v22')).match(url);
  assert.ok(migrated);
  assert.match(await migrated.text(), /background: white/);
});
