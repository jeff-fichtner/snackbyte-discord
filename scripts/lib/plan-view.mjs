// plan-view.mjs — render a Spec Kit plan.md as a navigable plan document.
//
// plan.md is a reference document (Summary, Technical Context, Constitution
// Check, Project Structure, Execution, Complexity Tracking), so the design is a
// clean two-column read: a header banner (branch / date) + sticky section nav
// with scroll-spy, sections rendered as readable prose with anchors, syntax
// highlighting, and tables. Recurring report-like sections get shape-aware
// rendering (Technical Context → definition grid, Constitution Check →
// principle cards). Heavier reference sections (Project Structure, Complexity
// Tracking) start collapsed. Cross-artifact navigation is the shared nav bar.
//
// Exports renderPlanView(src, { title, nav }) and looksLikePlan(src).

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { navBar, NAV_STYLES } from './artifact-nav.mjs';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        /* fall through */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});
const inline = (s) => md.renderInline(s);
const esc = (s) => md.utils.escapeHtml(s);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^\w ]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const H2_RE = /^##\s+(?!#)\s*(.+?)\s*$/;
const cleanHeading = (s) => s.replace(/[*`]/g, '').trim();

export function looksLikePlan(src) {
  const lines = src.split('\n');
  const has = (h) => lines.some((l) => new RegExp(`^##\\s+${h}`, 'i').test(l));
  return has('Summary') && (has('Technical Context') || has('Project Structure'));
}

function parse(src) {
  const lines = src.split('\n');
  const title = (lines.find((l) => /^#\s+/.test(l)) || 'Implementation Plan')
    .replace(/^#\s+/, '')
    .trim();

  // header meta line(s) before first H2 — e.g. **Branch**: ... | **Date**: ...
  let metaLine = '';
  let input = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (H2_RE.test(l)) break;
    if (/\*\*Branch\*\*|\*\*Date\*\*|\*\*Spec\*\*/.test(l)) metaLine = l;
    const im = l.match(/^\*\*Input\*\*:?\s*(.+)$/i);
    if (im) {
      input = im[1].trim();
      // absorb wrapped continuation lines of the Input value
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!next.trim() || /^\*\*.+?\*\*:/.test(next.trim()) || H2_RE.test(next)) break;
        input += ' ' + next.trim();
      }
    }
  }

  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h2 = line.match(H2_RE);
    if (h2) {
      cur = { heading: cleanHeading(h2[1]), lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return { title, metaLine, input, sections };
}

const COLLAPSED = (h) => {
  const x = h.toLowerCase();
  return x.includes('project structure') || x.includes('complexity');
};

// --- shape-aware section renderers ----------------------------------------
// plan.md sections share a few recurring shapes; render each as structure
// rather than a flat stack of prose.

// "**Label**: value" run -> a definition grid of label/value cards.
// Returns null if the block isn't predominantly key:value pairs.
function renderDefList(blockLines) {
  const items = [];
  let buf = null; // accumulate wrapped continuation lines into the current value
  let prose = [];
  const flush = () => {
    if (buf) {
      items.push(buf);
      buf = null;
    }
  };
  for (const raw of blockLines) {
    // A real label line is "**Label**:" — the colon must follow the closing
    // **. Lines that merely start with bold emphasis mid-sentence (no colon)
    // are continuations of the previous value, not new labels.
    const m = raw.match(/^\*\*([^*]+?)\*\*:\s*(.*)$/);
    if (m) {
      flush();
      buf = { label: m[1].trim(), value: m[2].trim() };
    } else if (buf && raw.trim()) {
      buf.value += ' ' + raw.trim();
    } else if (!buf && raw.trim() && !raw.startsWith('<!--')) {
      prose.push(raw);
    } else {
      flush();
    }
  }
  flush();
  if (items.length < 3) return null; // not a def-list-shaped section

  const naCls = (v) => (/^N\/A\b/i.test(v) ? ' na' : '');
  const cards = items
    .map(
      (it) => `<div class="def${naCls(it.value)}">
        <div class="def-k">${esc(it.label)}</div>
        <div class="def-v">${inline(it.value)}</div>
      </div>`,
    )
    .join('\n');
  const lead = prose.join('\n').trim()
    ? `<div class="sec-body">${md.render(prose.join('\n'))}</div>`
    : '';
  return `${lead}<div class="def-grid">${cards}</div>`;
}

// Constitution Check: a "| Principle | Compliance |" table where each cell ends
// in ✅/❌/⚠️ -> pass/fail principle cards with a status pill. Surrounding prose
// (GATE note, Result) is preserved.
function renderConstitution(blockLines) {
  const rows = [];
  let prose = [];
  let inTable = false;
  for (const raw of blockLines) {
    const line = raw.trim();
    if (/^\|/.test(line)) {
      inTable = true;
      if (/^\|[\s|:-]+\|?$/.test(line)) continue; // separator row
      const cells = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      if (/principle/i.test(cells[0]) && /complian/i.test(cells[1] || '')) continue; // header
      if (cells.length >= 2) rows.push({ name: cells[0], detail: cells[1] });
    } else {
      if (inTable) inTable = false;
      if (line && !line.startsWith('<!--')) prose.push(raw);
    }
  }
  if (!rows.length) return null;

  const verdict = (detail) => {
    if (/❌|🚫|\bFAIL\b/.test(detail)) return 'fail';
    if (/⚠️|\bRISK\b/.test(detail)) return 'warn';
    if (/✅|\bPASS\b/.test(detail)) return 'pass';
    return 'pass';
  };
  const cards = rows
    .map((r) => {
      const v = verdict(r.detail);
      const detail = r.detail
        .replace(/✅/gu, '')
        .replace(/❌/gu, '')
        .replace(/⚠️?/gu, '')
        .replace(/🚫/gu, '')
        .trim();
      const sym = { pass: '✓', warn: '!', fail: '✕' }[v];
      return `<details class="principle ${v}">
        <summary>
          <span class="pill ${v}">${sym}</span>
          <span class="pr-name">${inline(r.name)}</span>
          <span class="more">▸</span>
        </summary>
        <div class="pr-detail">${inline(detail)}</div>
      </details>`;
    })
    .join('\n');
  const note = prose.join('\n').trim()
    ? `<div class="sec-body pr-note">${md.render(prose.join('\n'))}</div>`
    : '';
  const counts = rows.reduce((a, r) => {
    a[verdict(r.detail)] = (a[verdict(r.detail)] || 0) + 1;
    return a;
  }, {});
  const tally = `<div class="pr-tally">
    <span class="pill pass">✓ ${counts.pass || 0}</span>
    ${counts.warn ? `<span class="pill warn">! ${counts.warn}</span>` : ''}
    ${counts.fail ? `<span class="pill fail">✕ ${counts.fail}</span>` : ''}
  </div>`;
  return `${tally}<div class="principles">${cards}</div>${note}`;
}

// File-tree code block: highlight NEW / CHANGED / UNCHANGED annotations.
function highlightTree(html) {
  return html
    .replace(/\bNEW\b/g, '<span class="anno new">NEW</span>')
    .replace(/\bUNCHANGED\b/g, '<span class="anno same">UNCHANGED</span>')
    .replace(/\b(CHANGED|MODIFY|EDIT)\b/g, '<span class="anno chg">$1</span>');
}

const STYLES = `
:root{
  --bg:#0e1014;--panel:#151922;--panel2:#1a1f2b;--text:#e7e9ef;--muted:#98a1b2;
  --line:#272d3b;--accent:#6ea8fe;--code-bg:#12161f;--ok:#39d39f;--toc-w:240px;
}
@media(prefers-color-scheme:light){:root{
  --bg:#fafbfd;--panel:#fff;--panel2:#f3f6fa;--text:#1a2230;--muted:#5a6472;
  --line:#dde3ec;--accent:#2563eb;--code-bg:#f2f4f7;--ok:#0fa968;}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:1rem;}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.layout{display:grid;grid-template-columns:var(--toc-w) 1fr;}
nav.toc{position:sticky;top:41px;align-self:start;height:calc(100vh - 41px);overflow-y:auto;
  padding:1.4rem 1rem;border-right:1px solid var(--line);background:var(--panel);font-size:.9rem;}
nav.toc .tt{font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 .6rem;}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:.28rem .5rem;border-radius:7px;}
nav.toc a:hover{color:var(--text);background:var(--panel2);}
nav.toc a.active{color:var(--accent);background:var(--panel2);}
main{padding:2rem 2.8rem 5rem;min-width:0;max-width:920px;}
.plan-head h1{font-size:1.7rem;margin:0 0 .6rem;}
.banner{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;font-size:.85rem;margin-bottom:.4rem;}
.banner .b{background:var(--panel2);border:1px solid var(--line);border-radius:99px;padding:.18rem .6rem;color:var(--muted);}
.banner .b b{color:var(--text);font-weight:650;}
.links{display:flex;gap:.5rem;margin:.5rem 0 1.4rem;}
.links a{font-size:.82rem;text-decoration:none;background:var(--panel);border:1px solid var(--line);
  padding:.3rem .7rem;border-radius:8px;color:var(--accent);}
.links a:hover{border-color:var(--accent);}
.intent{margin:0 0 1.4rem;padding:.7rem .9rem;background:var(--panel);border:1px solid var(--line);
  border-left:3px solid var(--accent);border-radius:0 8px 8px 0;color:var(--muted);font-size:.92rem;}
section.sec{margin:1.8rem 0 0;scroll-margin-top:1rem;}
section.sec>h2{font-size:1.25rem;margin:0 0 .7rem;padding-bottom:.35rem;border-bottom:1px solid var(--line);}
.sec-body h3{font-size:1.05rem;margin:1.2rem 0 .5rem;}
details.coll{background:var(--panel);border:1px solid var(--line);border-radius:11px;}
details.coll>summary{list-style:none;cursor:pointer;padding:.7rem 1rem;font-weight:650;color:var(--muted);}
details.coll>summary::-webkit-details-marker{display:none;}
details.coll>summary::before{content:"▸";margin-right:.5rem;display:inline-block;transition:transform .15s;}
details.coll[open]>summary::before{transform:rotate(90deg);}
.coll-body{padding:0 1.1rem 1rem;}
code{background:var(--panel2);padding:.1em .35em;border-radius:4px;font-size:.86em;font-family:ui-monospace,Menlo,monospace;}
pre.hljs{background:var(--code-bg);padding:.9rem 1rem;border-radius:8px;overflow-x:auto;border:1px solid var(--line);}
pre.hljs code{background:none;padding:0;}
table{border-collapse:collapse;width:100%;margin:.8rem 0;font-size:.9rem;}
th,td{border:1px solid var(--line);padding:.45rem .6rem;text-align:left;}
th{background:var(--panel2);}
blockquote{margin:.8rem 0;padding:.4rem .9rem;border-left:3px solid var(--accent);background:var(--panel2);color:var(--muted);border-radius:0 6px 6px 0;}
ul li,ol li{margin:.3rem 0;}
/* Technical Context -> definition grid */
.def-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.6rem;margin:.4rem 0;}
.def{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;}
.def-k{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);font-weight:800;margin-bottom:.25rem;}
.def-v{font-size:.9rem;color:var(--text);}
.def.na{opacity:.55;}
.def.na .def-k{color:var(--muted);}
/* Constitution Check -> principle cards */
.pr-tally{display:flex;gap:.4rem;margin:.2rem 0 .7rem;}
.principles{display:flex;flex-direction:column;gap:.4rem;}
details.principle{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--ok,#39d39f);border-radius:10px;overflow:hidden;}
details.principle.warn{border-left-color:#ffb454;}
details.principle.fail{border-left-color:#ff6b6b;}
details.principle>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;}
details.principle>summary::-webkit-details-marker{display:none;}
.pr-name{font-weight:650;flex:1;font-size:.92rem;}
.pill{display:inline-grid;place-items:center;min-width:1.3rem;height:1.3rem;padding:0 .4rem;border-radius:99px;font-size:.72rem;font-weight:800;}
.pill.pass{background:rgba(57,211,159,.18);color:#39d39f;}
.pill.warn{background:rgba(255,180,84,.18);color:#ffb454;}
.pill.fail{background:rgba(255,107,107,.18);color:#ff6b6b;}
.pr-detail{padding:.1rem .9rem .8rem 2.1rem;font-size:.9rem;color:var(--muted);border-top:1px solid var(--line);}
.pr-note{margin-top:.8rem;font-size:.88rem;}
.more{color:var(--muted);font-size:.72rem;transition:transform .15s;}
details[open] .more{transform:rotate(90deg);}
/* file-tree annotations */
.anno{font-size:.66rem;font-weight:800;padding:.02rem .3rem;border-radius:4px;vertical-align:middle;}
.anno.new{background:rgba(57,211,159,.2);color:#39d39f;}
.anno.chg{background:rgba(255,180,84,.2);color:#ffb454;}
.anno.same{background:var(--panel2);color:var(--muted);}
@media(max-width:820px){.layout{grid-template-columns:1fr;}nav.toc{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line);}main{padding:1.4rem 1.2rem;}.def-grid{grid-template-columns:1fr;}}
${NAV_STYLES}`;

const SCRIPT = `
const links=[...document.querySelectorAll('nav.toc a')];
const map=new Map(links.map(a=>[a.getAttribute('href').slice(1),a]));
const obs=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting){
  links.forEach(a=>a.classList.remove('active'));const a=map.get(e.target.id);if(a)a.classList.add('active');}}},
  {rootMargin:'0px 0px -75% 0px'});
document.querySelectorAll('section.sec').forEach(s=>obs.observe(s));
`;

export function renderPlanView(src, { title, nav } = {}) {
  const parsed = parse(src);
  const docTitle = title || parsed.title;

  const navItems = parsed.sections.map(
    (s) => `<a href="#${slug(s.heading)}">${esc(s.heading)}</a>`,
  );

  const bodyParts = parsed.sections.map((sec) => {
    const id = slug(sec.heading);
    const h = sec.heading.toLowerCase();

    // shape-aware rendering for the report-like sections
    let inner = null;
    if (h.includes('technical context')) inner = renderDefList(sec.lines);
    else if (h.includes('constitution')) inner = renderConstitution(sec.lines);

    if (inner) {
      return `<section class="sec" id="${id}"><h2>${esc(sec.heading)}</h2>${inner}</section>`;
    }

    // file-tree sections: render markdown then annotate NEW/CHANGED
    let body = md.render(sec.lines.join('\n'));
    if (h.includes('project structure')) body = highlightTree(body);

    if (COLLAPSED(sec.heading)) {
      return `<section class="sec" id="${id}"><h2>${esc(sec.heading)}</h2>
        <details class="coll"><summary>Show ${esc(sec.heading)}</summary><div class="coll-body sec-body">${body}</div></details>
        </section>`;
    }
    return `<section class="sec" id="${id}"><h2>${esc(sec.heading)}</h2><div class="sec-body">${body}</div></section>`;
  });

  // header banner from the meta line (Branch | Date | Spec)
  let banner = '';
  if (parsed.metaLine) {
    const parts = parsed.metaLine.split('|').map((p) => p.trim());
    banner = parts
      .map((p) => {
        const m = p.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
        return m ? `<span class="b"><b>${esc(m[1])}:</b> ${inline(m[2])}</span>` : '';
      })
      .filter(Boolean)
      .join('');
  }

  const intent = parsed.input ? `<div class="intent">${inline(parsed.input)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docTitle)}</title>
<style>${STYLES}</style>
</head>
<body>
${nav ? navBar(nav) : ''}
<div class="layout">
<nav class="toc"><p class="tt">Plan</p>${navItems.join('\n')}</nav>
<main>
  <div class="plan-head">
    <h1>${esc(docTitle)}</h1>
    <div class="banner">${banner}</div>
    ${intent}
  </div>
  ${bodyParts.join('\n')}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
