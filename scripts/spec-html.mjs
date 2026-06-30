#!/usr/bin/env node
// spec-html.mjs — render Spec Kit Markdown artifacts to interactive HTML.
//
// Markdown stays the source of truth (clean for the speckit skill chain and for
// git/GitHub). This produces a sibling .html view per .md file, wrapped in a
// styled shell: sticky auto-TOC, collapsible top-level sections, anchored
// headings, syntax-highlighted code, priority/status badges, and lazy Mermaid
// (only loaded client-side when a ```mermaid block is present).
//
// Generated .html files are derived artifacts (git-ignored). Run on demand:
//   npm run spec:html            # render every specs/**/*.md
//   npm run spec:html -- <path>  # render one file or one directory
//   npm run spec:html -- --clean # remove generated .html alongside .md

import { readdir, readFile, writeFile, stat, unlink, access } from 'node:fs/promises';
import { join, dirname, relative, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import hljs from 'highlight.js';
import { renderTasksTimeline, looksLikeTasks } from './lib/tasks-timeline.mjs';
import { renderSpecDashboard, looksLikeSpec } from './lib/spec-dashboard.mjs';
import { renderPlanView, looksLikePlan } from './lib/plan-view.mjs';
import { navBar, NAV_STYLES } from './lib/artifact-nav.mjs';

// Sibling artifact keys probed for the cross-nav bar (same order as the bar).
const NAV_KEYS = ['spec', 'plan', 'tasks', 'research', 'data-model', 'quickstart'];

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = join(REPO_ROOT, 'specs');
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

// --- Markdown renderer -----------------------------------------------------

// Mermaid fenced blocks must survive to the client unhighlighted; everything
// else goes through highlight.js.
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${md.utils.escapeHtml(code)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${
          hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        }</code></pre>`;
      } catch {
        /* fall through to plain escaping */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

const slugify = (s) =>
  encodeURIComponent(
    String(s)
      .trim()
      .toLowerCase()
      .replace(/[^\wÀ-￿\- ]/g, '')
      .replace(/\s+/g, '-'),
  );

md.use(anchor, {
  slugify,
  permalink: anchor.permalink.linkInsideHeader({
    symbol: '#',
    placement: 'after',
    ariaHidden: true,
  }),
});

// Collect headings during render so we can build a table of contents without a
// second parse. Reset per-document.
let headings = [];
const defaultHeadingOpen =
  md.renderer.rules.heading_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const level = Number(tokens[idx].tag.slice(1));
  const inline = tokens[idx + 1];
  const text = inline && inline.type === 'inline' ? inline.content : '';
  if (level >= 1 && level <= 3) {
    headings.push({ level, text, slug: slugify(text) });
  }
  return defaultHeadingOpen(tokens, idx, options, env, self);
};

// --- HTML shell ------------------------------------------------------------

const STYLES = `
:root {
  --bg: #0e1014; --panel: #161922; --text: #e6e8ee; --muted: #9aa3b2;
  --accent: #6ea8fe; --border: #262b36; --code-bg: #1b1f2a;
  --line: #262b36; --panel2: #1b1f2a;
  --p1: #ff6b6b; --p2: #ffb454; --p3: #7aa2ff;
  --toc-w: 280px; --maxread: 820px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff; --panel: #f6f7f9; --text: #1c2330; --muted: #5a6472;
    --accent: #2563eb; --border: #e2e6ec; --code-bg: #f2f4f7;
    --line: #e2e6ec; --panel2: #f2f4f7;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 1rem; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.layout { display: grid; grid-template-columns: var(--toc-w) 1fr; }
nav.toc {
  position: sticky; top: 41px; align-self: start; height: calc(100vh - 41px); overflow-y: auto;
  padding: 1.5rem 1rem; border-right: 1px solid var(--border); background: var(--panel);
  font-size: 0.9rem;
}
nav.toc .toc-title { font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  font-size: .72rem; color: var(--muted); margin: 0 0 .75rem; }
nav.toc a { display: block; color: var(--muted); text-decoration: none;
  padding: .2rem 0; border-left: 2px solid transparent; padding-left: .6rem; }
nav.toc a:hover { color: var(--text); }
nav.toc a.lvl-2 { padding-left: 1.4rem; }
nav.toc a.lvl-3 { padding-left: 2.2rem; font-size: .85rem; }
nav.toc a.active { color: var(--accent); border-left-color: var(--accent); }
main { padding: 2.5rem 3rem; min-width: 0; }
article { max-width: var(--maxread); }
h1, h2, h3, h4 { line-height: 1.25; font-weight: 700; }
h1 { font-size: 2rem; margin: 0 0 1.5rem; }
h2 { font-size: 1.4rem; margin: 2.2rem 0 .8rem; padding-bottom: .3rem; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.12rem; margin: 1.6rem 0 .6rem; }
a { color: var(--accent); }
.header-anchor { opacity: 0; margin-left: .4rem; text-decoration: none; font-weight: 400; }
:hover > .header-anchor { opacity: .5; }
code { background: var(--code-bg); padding: .12em .4em; border-radius: 4px; font-size: .88em;
  font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
pre { background: var(--code-bg); padding: 1rem 1.1rem; border-radius: 8px; overflow-x: auto;
  border: 1px solid var(--border); }
pre code { background: none; padding: 0; }
pre.mermaid { background: transparent; border: none; text-align: center; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .92rem; }
th, td { border: 1px solid var(--border); padding: .5rem .7rem; text-align: left; }
th { background: var(--panel); }
blockquote { margin: 1rem 0; padding: .5rem 1rem; border-left: 3px solid var(--accent);
  background: var(--panel); color: var(--muted); border-radius: 0 6px 6px 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
ul, ol { padding-left: 1.4rem; }
li { margin: .25rem 0; }
details { border: 1px solid var(--border); border-radius: 8px; margin: 1rem 0; background: var(--panel); }
details > summary { cursor: pointer; padding: .8rem 1rem; font-weight: 600; list-style: none; }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: "\\25B8"; display: inline-block; margin-right: .6rem;
  transition: transform .15s; color: var(--muted); }
details[open] > summary::before { transform: rotate(90deg); }
details > .details-body { padding: 0 1rem 1rem; }
.badge { display: inline-block; font-size: .7rem; font-weight: 700; padding: .1rem .5rem;
  border-radius: 999px; margin-left: .4rem; vertical-align: middle; letter-spacing: .03em; }
.badge.p1 { background: var(--p1); color: #1a0000; }
.badge.p2 { background: var(--p2); color: #2a1600; }
.badge.p3 { background: var(--p3); color: #00261a; }
.badge.status { background: var(--accent); color: #00112e; }
.meta { color: var(--muted); font-size: .9rem; margin: -1rem 0 1.5rem; }
@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  nav.toc { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
  main { padding: 1.5rem 1.2rem; }
}
${NAV_STYLES}`;

const tocScript = `
const links = [...document.querySelectorAll('nav.toc a')];
const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
const obs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      links.forEach(a => a.classList.remove('active'));
      const a = map.get(e.target.id);
      if (a) a.classList.add('active');
    }
  }
}, { rootMargin: '0px 0px -75% 0px' });
document.querySelectorAll('h1[id],h2[id],h3[id]').forEach(h => obs.observe(h));
`;

// Add P1/P2/P3 + Status badges by lightly post-processing the rendered HTML.
function decorate(html) {
  return html
    .replace(
      /\(Priority:\s*(P[123])\)/g,
      (_, p) => `<span class="badge ${p.toLowerCase()}">${p}</span>`,
    )
    .replace(
      // capture the whole status value (up to the end of the line / next tag),
      // not just letters — so "In-Progress", "Draft (v2)", "Ready/Review" survive
      /(\*\*Status\*\*:\s*|<strong>Status<\/strong>:\s*)([^<\n]+)/g,
      (_, lead, val) => `${lead}<span class="badge status">${val.trim()}</span>`,
    );
}

function buildToc(items) {
  if (!items.length) return '';
  const rows = items
    .map((h) => `<a class="lvl-${h.level}" href="#${h.slug}">${md.utils.escapeHtml(h.text)}</a>`)
    .join('\n');
  return `<nav class="toc"><p class="toc-title">Contents</p>${rows}</nav>`;
}

function page({ title, toc, body, hasMermaid, nav }) {
  const mermaid = hasMermaid
    ? `<script type="module">
import mermaid from '${MERMAID_CDN}';
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({ startOnLoad: true, theme: dark ? 'dark' : 'default' });
</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${md.utils.escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${nav ? navBar(nav) : ''}
<div class="layout">
${toc}
<main><article>${body}</article></main>
</div>
<script>${tocScript}</script>
${mermaid}
</body>
</html>
`;
}

// --- File walking ----------------------------------------------------------

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      yield full;
    }
  }
}

async function renderFile(mdPath) {
  const src = await readFile(mdPath, 'utf8');
  const title =
    (src.match(/^#\s+(.+)$/m) || [])[1]?.replace(/[#*`]/g, '').trim() || basename(mdPath, '.md');
  const outPath = mdPath.replace(/\.md$/, '.html');
  const name = basename(mdPath);
  const dir = dirname(mdPath);

  // Discover which sibling artifacts exist so every view can render a
  // cross-navigation bar, and tag which one is current. `feature` is the
  // containing feature dir name (e.g. "003-env-manifest") for the bar label.
  const key = name.replace(/\.md$/, '');
  const siblings = Object.fromEntries(
    await Promise.all(NAV_KEYS.map(async (k) => [k, await exists(join(dir, `${k}.md`))])),
  );
  const feature = relative(SPECS_DIR, dir).split('/')[0] || basename(dir);
  const nav = { siblings, current: key, feature };

  // The three primary artifacts get purpose-built views; everything else
  // (research, data-model, quickstart, contracts, checklists, …) gets the
  // generic readable view below. All four embed the same cross-nav bar.
  if (name === 'tasks.md' && looksLikeTasks(src)) {
    await writeFile(outPath, renderTasksTimeline(src, { title, nav }), 'utf8');
    return outPath;
  }
  if (name === 'spec.md' && looksLikeSpec(src)) {
    await writeFile(outPath, renderSpecDashboard(src, { title, nav }), 'utf8');
    return outPath;
  }
  if (name === 'plan.md' && looksLikePlan(src)) {
    await writeFile(outPath, renderPlanView(src, { title, nav }), 'utf8');
    return outPath;
  }

  headings = [];
  let body = md.render(src);
  body = decorate(body);
  const hasMermaid = body.includes('<pre class="mermaid">');
  const toc = buildToc(headings);
  const html = page({ title, toc, body, hasMermaid, nav });
  await writeFile(outPath, html, 'utf8');
  return outPath;
}

async function resolveTargets(arg) {
  if (!arg) return SPECS_DIR;
  const p = resolve(REPO_ROOT, arg);
  return p;
}

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const pathArg = args.find((a) => !a.startsWith('--'));
  const target = await resolveTargets(pathArg);

  let files = [];
  const s = await stat(target).catch(() => null);
  if (!s) {
    console.error(`Path not found: ${target}`);
    process.exit(1);
  }
  if (s.isFile()) {
    if (!target.endsWith('.md')) {
      console.error('Target must be a .md file or a directory.');
      process.exit(1);
    }
    files = [target];
  } else {
    for await (const f of walk(target)) files.push(f);
  }

  if (clean) {
    let removed = 0;
    for (const f of files) {
      const htmlPath = f.replace(/\.md$/, '.html');
      try {
        await unlink(htmlPath);
        removed++;
      } catch {
        /* not present */
      }
    }
    console.log(`Removed ${removed} generated .html file(s).`);
    return;
  }

  if (!files.length) {
    console.log('No .md files found.');
    return;
  }

  let n = 0;
  for (const f of files) {
    const out = await renderFile(f);
    console.log(`  ${relative(REPO_ROOT, f)} -> ${relative(REPO_ROOT, out)}`);
    n++;
  }
  console.log(`\nRendered ${n} file(s) to HTML.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
