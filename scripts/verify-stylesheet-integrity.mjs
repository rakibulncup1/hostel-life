import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const mode = args.includes('--dist') ? 'dist' : 'source';
const rootArgIndex = args.indexOf('--root');
const projectRoot = path.resolve(rootArgIndex >= 0 ? args[rootArgIndex + 1] || defaultRoot : defaultRoot);
const outputRoot = mode === 'dist' ? path.join(projectRoot, 'dist') : projectRoot;
const issues = [];
const counts = { sourceImports: 0, cssImports: 0, publicStylesheets: 0, cssUrls: 0, builtEntryStylesheets: 0, builtScripts: 0 };

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function exists(filePath) {
  try { await access(filePath); return true; }
  catch { return false; }
}

function cleanReference(value) {
  return value.trim().replace(/[?#].*$/, '');
}

function isExternal(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function resolveHtmlAsset(rawValue, htmlFile) {
  const value = cleanReference(rawValue);
  if (!value || isExternal(value)) return null;
  if (value.startsWith('/')) {
    if (mode === 'dist') return path.join(outputRoot, value.slice(1));
    const publicRoot = path.join(projectRoot, 'public');
    const isPublicHtml = htmlFile.startsWith(`${publicRoot}${path.sep}`);
    return path.join(isPublicHtml ? publicRoot : projectRoot, value.slice(1));
  }
  return path.resolve(path.dirname(htmlFile), value);
}

function resolveCssImport(rawValue, importer) {
  const value = cleanReference(rawValue);
  if (!value || isExternal(value)) return null;
  if (value.startsWith('/')) {
    const staticRoot = mode === 'dist' ? outputRoot : path.join(projectRoot, 'public');
    return path.join(staticRoot, value.slice(1));
  }
  // Bare package imports are left to Vite's resolver. Relative imports are local.
  if (!value.startsWith('.')) return null;
  return path.resolve(path.dirname(importer), value);
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

async function inspectHtml(htmlFile, builtIndex = false) {
  const html = await readFile(htmlFile, 'utf8');
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.get('rel') || '').toLowerCase().split(/\s+/);
    const href = attrs.get('href');
    if (!href) continue;
    if (rel.includes('stylesheet')) {
      if (builtIndex) counts.builtEntryStylesheets += 1;
      else counts.publicStylesheets += 1;
      const target = resolveHtmlAsset(href, htmlFile);
      if (target && !(await exists(target))) issues.push(`${path.relative(projectRoot, htmlFile)} references missing stylesheet: ${href}`);
    }
    if (builtIndex && rel.includes('modulepreload')) {
      const target = resolveHtmlAsset(href, htmlFile);
      if (target && !(await exists(target))) issues.push(`dist/index.html references missing module preload: ${href}`);
    }
  }

  if (builtIndex) {
    for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
      const attrs = parseAttributes(match[0]);
      if ((attrs.get('type') || '').toLowerCase() !== 'module') continue;
      const src = attrs.get('src');
      if (!src) continue;
      counts.builtScripts += 1;
      const target = resolveHtmlAsset(src, htmlFile);
      if (target && !(await exists(target))) issues.push(`dist/index.html references missing module script: ${src}`);
    }
  }
}

async function inspectCssFile(cssFile) {
  const css = await readFile(cssFile, 'utf8');
  // Relative @import is not always bundled in public CSS, so verify its source file.
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(?:"([^\"]+)"|'([^']+)'|([^\s;\)]+))/gi)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const target = resolveCssImport(raw, cssFile);
    if (target) {
      counts.cssImports += 1;
      if (!(await exists(target))) issues.push(`${path.relative(projectRoot, cssFile)} imports missing CSS: ${raw}`);
    }
  }

  for (const match of css.matchAll(/url\(\s*(?:"([^\"]+)"|'([^']+)'|([^\s\)]+))\s*\)/gi)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    const value = cleanReference(raw);
    if (!value || isExternal(value) || value.startsWith('var(') || value.startsWith('data:') || value.startsWith('blob:')) continue;
    const staticRoot = mode === 'dist' ? outputRoot : path.join(projectRoot, 'public');
    const target = value.startsWith('/')
      ? path.join(staticRoot, value.slice(1))
      : path.resolve(path.dirname(cssFile), value);
    counts.cssUrls += 1;
    if (!(await exists(target))) issues.push(`${path.relative(projectRoot, cssFile)} references missing CSS asset: ${raw}`);
  }
}

async function runSourceChecks() {
  const srcRoot = path.join(projectRoot, 'src');
  const sourceFiles = (await walk(srcRoot)).filter((file) => /\.(?:[cm]?[jt]sx?)$/i.test(file));
  const importPatterns = [
    /\bimport\s+['"]([^'"]+\.css(?:\?[^'"]*)?)['"]/g,
    /\bimport\s+[^;'"\n]+?\s+from\s+['"]([^'"]+\.css(?:\?[^'"]*)?)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+\.css(?:\?[^'"]*)?)['"]\s*\)/g,
  ];

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    const seen = new Set();
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) seen.add(match[1]);
    }
    for (const raw of seen) {
      const target = resolveCssImport(raw, sourceFile);
      if (!target) continue;
      counts.sourceImports += 1;
      if (!(await exists(target))) issues.push(`${path.relative(projectRoot, sourceFile)} imports missing CSS: ${raw}`);
    }
  }

  const publicHtmlFiles = (await walk(path.join(projectRoot, 'public'))).filter((file) => file.endsWith('.html'));
  for (const htmlFile of publicHtmlFiles) await inspectHtml(htmlFile, false);

  const cssFiles = [
    ...(await walk(path.join(projectRoot, 'src'))).filter((file) => file.endsWith('.css')),
    ...(await walk(path.join(projectRoot, 'public'))).filter((file) => file.endsWith('.css')),
  ];
  for (const cssFile of cssFiles) await inspectCssFile(cssFile);

  // The SPA's entry document must load the React module that imports global CSS.
  const indexFile = path.join(projectRoot, 'index.html');
  if (!(await exists(indexFile))) issues.push('Root index.html is missing.');
  else {
    const html = await readFile(indexFile, 'utf8');
    const moduleSrc = [...html.matchAll(/<script\b[^>]*>/gi)]
      .map((match) => parseAttributes(match[0]))
      .find((attrs) => (attrs.get('type') || '').toLowerCase() === 'module')?.get('src');
    if (!moduleSrc) issues.push('Root index.html has no module entry script.');
    else {
      const target = resolveHtmlAsset(moduleSrc, indexFile);
      if (target && !(await exists(target))) issues.push(`Root index.html references missing module entry: ${moduleSrc}`);
    }
  }
}

async function runDistChecks() {
  if (!(await exists(outputRoot))) {
    issues.push('dist/ does not exist. Run Vite build before --dist verification.');
    return;
  }
  const htmlFiles = (await walk(outputRoot)).filter((file) => file.endsWith('.html'));
  const indexFile = path.join(outputRoot, 'index.html');
  if (!(await exists(indexFile))) issues.push('dist/index.html is missing.');

  for (const htmlFile of htmlFiles) await inspectHtml(htmlFile, htmlFile === indexFile);
  if (counts.builtEntryStylesheets === 0) issues.push('dist/index.html contains no stylesheet link for the SPA bundle.');
  if (counts.builtScripts === 0) issues.push('dist/index.html contains no module script for the SPA bundle.');
}

if (mode === 'dist') await runDistChecks();
else await runSourceChecks();

const prefix = mode === 'dist' ? '[stylesheet-integrity:dist]' : '[stylesheet-integrity:source]';
if (issues.length) {
  console.error(`${prefix} FAILED — ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(`${prefix} OK`, JSON.stringify(counts));
}
