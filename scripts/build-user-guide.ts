// ── User-guide build script ───────────────────────────────────────────────
//
// Reads the same HELP_SECTIONS used by the in-app HelpScreen and emits:
//   • docs/USER_GUIDE.md   — printable Markdown source-of-truth
//   • docs/USER_GUIDE.html — print-ready stylesheet (for PDF conversion)
//
// Single source: src/help/content.ts. Update content there and re-run
// this script. To generate the PDF locally:
//
//   npx tsx scripts/build-user-guide.ts
//   # then either: open docs/USER_GUIDE.html in a browser → Print → Save as PDF
//   # or:          npx puppeteer-cli pdf docs/USER_GUIDE.html docs/USER_GUIDE.pdf
//
// No new package.json deps — runs via npx tsx with the existing TS toolchain.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP_SECTIONS, type HelpBlock, type HelpSection } from '../src/help/content';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const DOCS_DIR = resolve(REPO_ROOT, 'docs');

function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mdEscape(text: string): string {
  // Markdown is permissive — only escape the few characters that matter
  // inside paragraph bodies. We don't touch curly quotes, em dashes, etc.
  return text.replace(/([\\`*_{}\[\]()#+\-!])/g, '\\$1').replace(/\\([\s.,'"’`])/g, '$1');
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdownBlock(block: HelpBlock): string {
  switch (block.type) {
    case 'h3':
      return `### ${block.text}\n`;
    case 'p':
      return `${block.text}\n`;
    case 'li':
      return `- ${block.text}`;
    case 'tip':
      return `> **Tip:** ${block.text}\n`;
    case 'note':
      return `> **Note:** ${block.text}\n`;
  }
}

function renderHtmlBlock(block: HelpBlock): string {
  switch (block.type) {
    case 'h3':
      return `<h3>${htmlEscape(block.text)}</h3>`;
    case 'p':
      return `<p>${htmlEscape(block.text)}</p>`;
    case 'li':
      return `<li>${htmlEscape(block.text)}</li>`;
    case 'tip':
      return `<aside class="tip"><strong>TIP</strong><div>${htmlEscape(block.text)}</div></aside>`;
    case 'note':
      return `<aside class="note"><strong>NOTE</strong><div>${htmlEscape(block.text)}</div></aside>`;
  }
}

// Markdown rendering needs to wrap consecutive <li> blocks inside a list.
function renderMarkdownSection(section: HelpSection): string {
  const parts: string[] = [];
  parts.push(`## ${section.title}`);
  parts.push('');
  parts.push(`*${section.summary}*`);
  parts.push('');
  let i = 0;
  while (i < section.blocks.length) {
    const b = section.blocks[i];
    if (b.type === 'li') {
      // Collect contiguous li run
      const items: string[] = [];
      while (i < section.blocks.length && section.blocks[i].type === 'li') {
        items.push(`- ${section.blocks[i].text}`);
        i++;
      }
      parts.push(items.join('\n'));
      parts.push('');
    } else {
      parts.push(renderMarkdownBlock(b));
      if (b.type !== 'h3') parts.push('');
      i++;
    }
  }
  return parts.join('\n');
}

function renderHtmlSection(section: HelpSection): string {
  const parts: string[] = [];
  parts.push(`<section id="${slug(section.id)}">`);
  parts.push(`  <h2>${htmlEscape(section.title)}</h2>`);
  parts.push(`  <p class="summary">${htmlEscape(section.summary)}</p>`);
  let i = 0;
  while (i < section.blocks.length) {
    const b = section.blocks[i];
    if (b.type === 'li') {
      parts.push('  <ul>');
      while (i < section.blocks.length && section.blocks[i].type === 'li') {
        parts.push(`    ${renderHtmlBlock(section.blocks[i])}`);
        i++;
      }
      parts.push('  </ul>');
    } else {
      parts.push(`  ${renderHtmlBlock(b)}`);
      i++;
    }
  }
  parts.push('</section>');
  return parts.join('\n');
}

function buildMarkdown(): string {
  const lines: string[] = [];
  lines.push('# Bior — User Guide');
  lines.push('');
  lines.push(
    'This guide mirrors the in-app help. Open the app → hamburger → "Help & user guide" for the searchable version, or read on for the printable copy.'
  );
  lines.push('');
  lines.push('## Contents');
  lines.push('');
  for (const s of HELP_SECTIONS) {
    lines.push(`- [${s.title}](#${slug(s.id)})`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const section of HELP_SECTIONS) {
    lines.push(renderMarkdownSection(section));
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

const PRINT_CSS = `
:root {
  --primary: #1a73e8;
  --primary-light: #e8f0fe;
  --text: #1a1a1a;
  --muted: #555;
  --accent: #ff6b35;
  --rule: #e0e0e0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  font-size: 12pt;
  line-height: 1.45;
}
body {
  padding: 0.75in 0.75in 1in 0.75in;
  max-width: 7in;
  margin: 0 auto;
}
header.cover {
  border-bottom: 4px solid var(--primary);
  padding-bottom: 14px;
  margin-bottom: 28px;
}
header.cover h1 {
  font-size: 28pt;
  margin: 0;
  color: var(--primary);
  letter-spacing: -0.5px;
}
header.cover .subtitle {
  font-size: 11pt;
  color: var(--muted);
  margin-top: 6px;
}
nav.toc {
  background: var(--primary-light);
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 28px;
  page-break-after: always;
}
nav.toc h2 {
  margin: 0 0 8px 0;
  font-size: 14pt;
  color: var(--primary);
}
nav.toc ol {
  margin: 0;
  padding-left: 22px;
}
nav.toc li {
  margin: 4px 0;
  font-size: 11pt;
}
nav.toc a {
  color: var(--text);
  text-decoration: none;
}
section {
  page-break-before: always;
  margin-bottom: 28px;
}
section:first-of-type {
  page-break-before: auto;
}
section h2 {
  font-size: 18pt;
  color: var(--primary);
  margin: 0 0 4px 0;
  border-bottom: 2px solid var(--rule);
  padding-bottom: 6px;
}
section .summary {
  font-style: italic;
  color: var(--muted);
  margin: 8px 0 14px 0;
  font-size: 11pt;
}
section h3 {
  font-size: 13pt;
  color: var(--text);
  margin: 18px 0 6px 0;
}
section p {
  margin: 0 0 10px 0;
}
section ul {
  margin: 6px 0 12px 22px;
  padding: 0;
}
section li {
  margin: 4px 0;
}
aside.tip, aside.note {
  border-radius: 6px;
  padding: 10px 14px;
  margin: 12px 0;
  font-size: 11pt;
  display: block;
}
aside.tip {
  background: var(--primary-light);
  border-left: 4px solid var(--primary);
}
aside.tip strong {
  color: var(--primary);
  font-size: 9pt;
  letter-spacing: 1.4px;
  display: block;
  margin-bottom: 4px;
}
aside.note {
  background: #f5f5f5;
  border-left: 4px solid #888;
}
aside.note strong {
  color: #555;
  font-size: 9pt;
  letter-spacing: 1.4px;
  display: block;
  margin-bottom: 4px;
}
footer {
  margin-top: 36px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  font-size: 9pt;
  color: var(--muted);
  text-align: center;
}
@media print {
  body { padding: 0; }
  nav.toc { box-shadow: none; }
}
`;

function buildHtml(): string {
  const today = new Date().toISOString().slice(0, 10);
  const tocHtml = HELP_SECTIONS.map(
    (s) => `    <li><a href="#${slug(s.id)}">${htmlEscape(s.title)}</a> — ${htmlEscape(s.summary)}</li>`
  ).join('\n');
  const sectionsHtml = HELP_SECTIONS.map(renderHtmlSection).join('\n\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bior — User Guide</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <header class="cover">
    <h1>Bior</h1>
    <div class="subtitle">User Guide · v1.0.0 · ${today}</div>
  </header>
  <nav class="toc">
    <h2>Contents</h2>
    <ol>
${tocHtml}
    </ol>
  </nav>
${sectionsHtml}
  <footer>
    Bior User Guide · Generated from in-app help · © ${new Date().getFullYear()} Jon Collis
  </footer>
</body>
</html>
`;
}

mkdirSync(DOCS_DIR, { recursive: true });
const mdPath = resolve(DOCS_DIR, 'USER_GUIDE.md');
const htmlPath = resolve(DOCS_DIR, 'USER_GUIDE.html');
writeFileSync(mdPath, buildMarkdown(), 'utf8');
writeFileSync(htmlPath, buildHtml(), 'utf8');

// eslint-disable-next-line no-console
console.log(`Wrote ${mdPath}`);
// eslint-disable-next-line no-console
console.log(`Wrote ${htmlPath}`);
