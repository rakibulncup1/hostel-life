import { readFile, writeFile } from 'node:fs/promises';
import { LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED } from '../src/content/legalDocuments.js';

const bnDigits = (value) => String(value).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function renderToc(document, key) {
  return document.sections.map((section, index) =>
    `          <a href="#${escapeHtml(section.id)}" data-i18n-key="${key}.section.${escapeHtml(section.id)}.toc"><span>${bnDigits(String(index + 1).padStart(2, '0'))}</span>${escapeHtml(section.toc || section.title)}</a>`,
  ).join('\n');
}

function renderArticle(document, key) {
  const sections = document.sections.map((section, index) => {
    const paragraphs = section.paragraphs.map((paragraph, paragraphIndex) => `              <p data-i18n-key="${key}.section.${escapeHtml(section.id)}.p${paragraphIndex + 1}">${escapeHtml(paragraph)}</p>`).join('\n');
    return `          <section class="legal-section" id="${escapeHtml(section.id)}">\n            <span class="legal-number" aria-hidden="true">${bnDigits(String(index + 1).padStart(2, '0'))}</span>\n            <div><h2 data-i18n-key="${key}.section.${escapeHtml(section.id)}.title">${escapeHtml(section.title)}</h2>\n${paragraphs}\n            </div>\n          </section>`;
  }).join('\n');

  return `      <article class="legal-document" aria-label="${escapeHtml(document.title)}-এর সম্পূর্ণ বিবরণ">\n        <div class="legal-intro" data-i18n-key="${key}.intro">${escapeHtml(document.intro)}</div>\n        <div class="legal-sections">\n${sections}\n        </div>\n        <div class="legal-contact">\n          <strong data-i18n-key="${key}.contact.title">${escapeHtml(document.contactTitle)}</strong>\n          <p data-i18n-key="${key}.contact.description">${escapeHtml(document.contactText)}</p>\n          <a class="btn btn-primary" href="mailto:support.sec1.info@gmail.com" data-i18n-key="legal.contact.action">যোগাযোগ করুন ↗</a>\n        </div>\n      </article>`;
}

async function updatePage(key) {
  const document = LEGAL_DOCUMENTS[key];
  const path = new URL(`../public/${document.slug}.html`, import.meta.url);
  let html = await readFile(path, 'utf8');

  const replacements = [
    [/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(document.description)}">`],
    [/<title>[^<]*<\/title>/, `<title>${escapeHtml(document.title)} — Hostel Life</title>`],
    [/<span class="legal-eyebrow"[^>]*><i><\/i>[^<]*<\/span>\s*(?:<h1[^>]*>[^<]*<\/h1>\s*)?<p[^>]*>[\s\S]*?<\/p>/, `<span class="legal-eyebrow" data-i18n-key="${key}.eyebrow"><i></i> ${escapeHtml(document.eyebrow)}</span>\n        <h1 data-i18n-key="${key}.title">${escapeHtml(document.title)}</h1>\n        <p data-i18n-key="${key}.description">${escapeHtml(document.description)}</p>`],
    [/সর্বশেষ হালনাগাদ: [^<]*/, `সর্বশেষ হালনাগাদ: ${LEGAL_LAST_UPDATED}`],
  ];
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(html)) throw new Error(`${document.slug}: expected page marker not found: ${pattern}`);
    html = html.replace(pattern, replacement);
  }

  const tocOpen = '<div class="legal-contents-links">';
  const tocStart = html.indexOf(tocOpen);
  if (tocStart < 0) throw new Error(`${document.slug}: legal contents block not found`);
  const tocContentStart = tocStart + tocOpen.length;
  const tocEnd = html.indexOf('</div>', tocContentStart);
  if (tocEnd < 0) throw new Error(`${document.slug}: legal contents block is not closed`);
  html = `${html.slice(0, tocContentStart)}\n${renderToc(document, key)}\n        ${html.slice(tocEnd)}`;

  const articleOpen = '<article class="legal-document"';
  const articleStart = html.indexOf(articleOpen);
  const articleEndMarker = '</article>';
  const articleEnd = html.indexOf(articleEndMarker, articleStart);
  if (articleStart < 0 || articleEnd < 0) throw new Error(`${document.slug}: legal article block not found`);
  // Replace from the beginning of the article line so indentation cannot
  // accumulate when the generator runs repeatedly.
  const articleLineStart = html.lastIndexOf('\n', articleStart) + 1;
  html = `${html.slice(0, articleLineStart)}${renderArticle(document, key)}${html.slice(articleEnd + articleEndMarker.length)}`;

  await writeFile(path, html, 'utf8');
}

await updatePage('privacy');
await updatePage('terms');
