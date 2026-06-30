// spec-dashboard.mjs — render a Spec Kit spec.md as a skimmable dashboard.
//
// Header band (status, branch, date, intent) + sticky section nav. User stories
// become priority-badged cards with collapsed why/test/acceptance detail and
// Given/When/Then scenarios. Functional requirements and success criteria become
// compact ID-tagged cards (FR-### / SC-###) with the MUST/SHOULD keyword
// highlighted. Context / Clarifications / Assumptions / other prose sections
// collapse. Falls back (caller decides) when the file lacks the standard shape.
//
// Exports renderSpecDashboard(src, { title, nav }) and looksLikeSpec(src).

import MarkdownIt from 'markdown-it';
import { navBar, NAV_STYLES } from './artifact-nav.mjs';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const inline = (s) => md.renderInline(s);
const esc = (s) => md.utils.escapeHtml(s);
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^\w ]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const H2_RE = /^##\s+(?!#)\s*(.+?)\s*$/;
const H3_RE = /^###\s+(?!#)\s*(.+?)\s*$/;
const STORY_RE = /^User Story\s+(\d+)\s*[-—]\s*(.+?)\s*\(Priority:\s*(P\d)[^)]*\)/i;
const REQ_RE = /^\s*-\s*\*\*(FR|SC|NFR)-([\w.]+)\*\*:?\s*(.*)$/;

// strip markdown emphasis/section annotations like "*(mandatory)*"
const cleanHeading = (s) =>
  s
    .replace(/\*\(.*?\)\*/g, '')
    .replace(/[*`]/g, '')
    .trim();

export function looksLikeSpec(src) {
  const lines = src.split('\n');
  const hasStories = lines.some((l) => /^###\s+User Story/i.test(l));
  const hasReqs = lines.some((l) => REQ_RE.test(l));
  return hasStories || hasReqs;
}

// --- parse into ordered sections ------------------------------------------

function parse(src) {
  const lines = src.split('\n');

  // header meta (between H1 and first H2)
  const title = (lines.find((l) => /^#\s+/.test(l)) || 'Specification').replace(/^#\s+/, '').trim();
  const meta = {};
  // Pick a "**Key**: value" metadata field, absorbing wrapped continuation
  // lines (the value often spans multiple lines until a blank line or the next
  // bold field / heading).
  const metaPick = (key) => {
    const re = new RegExp(`^\\*\\*${key}\\*\\*:?\\s*(.+)$`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      let val = m[1].trim();
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!next.trim()) break; // blank line ends the value
        if (/^\*\*.+?\*\*:/.test(next.trim())) break; // next field
        if (/^#{1,6}\s/.test(next)) break; // heading
        val += ' ' + next.trim();
      }
      return val;
    }
    return null;
  };
  meta.status = metaPick('Status');
  meta.branch = metaPick('Feature Branch');
  meta.created = metaPick('Created');
  meta.input = metaPick('Input');

  // split into H2 sections
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h2 = line.match(H2_RE);
    if (h2) {
      cur = { heading: cleanHeading(h2[1]), raw: h2[1], lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return { title, meta, sections };
}

// Edge Cases bullets: "- **Lead.** explanation…" (often multi-line) -> cards
// with the bold lead as a title and the explanation as the body.
function renderEdgeCards(blockLines) {
  const items = [];
  let buf = null;
  const flush = () => {
    if (buf) items.push(buf);
    buf = null;
  };
  for (const raw of blockLines) {
    const b = raw.match(/^\s*-\s+(.*)$/);
    if (b) {
      flush();
      buf = { text: b[1].trim() };
    } else if (buf && raw.trim()) {
      buf.text += ' ' + raw.trim();
    } else {
      flush();
    }
  }
  flush();
  if (!items.length) return '';

  return items
    .map((it) => {
      // pull a leading "**Lead.**" / "**Lead**" as the title; rest is body
      const m = it.text.match(/^\*\*(.+?)\*\*\.?\s*(.*)$/);
      const title = m ? m[1].trim() : it.text;
      const body = m ? m[2].trim() : '';
      return `<details class="edge">
        <summary><span class="edge-q">?</span><span class="edge-t">${inline(title)}</span>${body ? '<span class="more">▸</span>' : ''}</summary>
        ${body ? `<div class="edge-b">${inline(body)}</div>` : ''}
      </details>`;
    })
    .join('\n');
}

// Key Entities bullets: "- **Entity name**: definition…" (often multi-line) ->
// a grid of entity cards with the name as a heading. Returns null if the lines
// aren't entity-shaped (so the caller can fall back to prose).
function renderEntityCards(proseLines) {
  const items = [];
  let buf = null;
  const flush = () => {
    if (buf) items.push(buf);
    buf = null;
  };
  for (const raw of proseLines) {
    const m = raw.match(/^\s*-\s+\*\*(.+?)\*\*:?\s*(.*)$/);
    if (m) {
      flush();
      buf = { name: m[1].trim(), desc: m[2].trim() };
    } else if (buf && raw.trim()) {
      buf.desc += ' ' + raw.trim();
    } else if (!raw.trim()) {
      flush();
    }
  }
  flush();
  if (items.length < 2) return null;

  const cards = items
    .map(
      (it) => `<div class="entity">
        <div class="entity-name">${inline(it.name)}</div>
        <div class="entity-desc">${inline(it.desc)}</div>
      </div>`,
    )
    .join('\n');
  return `<div class="entity-grid">${cards}</div>`;
}

// --- section renderers -----------------------------------------------------

function renderStories(blockLines) {
  // split by H3 User Story headers
  const out = [];
  let cur = null;
  let edge = null;
  for (const line of blockLines) {
    const h3 = line.match(H3_RE);
    if (h3) {
      const sm = h3[1].match(STORY_RE);
      if (sm) {
        cur = { n: sm[1], title: sm[2], pri: sm[3], lines: [] };
        out.push({ kind: 'story', data: cur });
        edge = null;
        continue;
      }
      // non-story H3 (e.g. Edge Cases) → prose subsection
      cur = null;
      edge = { heading: cleanHeading(h3[1]), lines: [] };
      out.push({ kind: 'sub', data: edge });
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (edge) edge.lines.push(line);
  }

  return out
    .map((item) => {
      if (item.kind === 'sub') {
        // Edge Cases gets promoted to scannable cards instead of a buried
        // collapsed sub-accordion — they're substantive, not a footnote.
        if (/edge case/i.test(item.data.heading)) {
          const cards = renderEdgeCards(item.data.lines);
          if (cards)
            return `<div class="edge-block"><h4 class="edge-head">⚠ Edge Cases</h4>${cards}</div>`;
        }
        const body = md.render(item.data.lines.join('\n'));
        if (!body.trim()) return '';
        return `<details class="sub"><summary>${esc(item.data.heading)}</summary><div class="sub-body">${body}</div></details>`;
      }
      const s = item.data;
      const body = md.render(s.lines.join('\n'));
      return `<details class="story-card pri-${s.pri.toLowerCase()}">
        <summary>
          <span class="pri-badge ${s.pri.toLowerCase()}">${s.pri}</span>
          <span class="story-n">US${s.n}</span>
          <span class="story-title">${esc(s.title)}</span>
          <span class="more">▸</span>
        </summary>
        <div class="story-body">${body}</div>
      </details>`;
    })
    .join('\n');
}

// Highlight RFC-2119 keywords, but only in text nodes — never inside HTML tags
// or entities produced by markdown-it (a "MAY"/"MUST" inside an inline code
// span, URL, or attribute must stay untouched). Operates on already-rendered
// inline HTML by replacing only the segments that sit between tags.
const KW_RE = /\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/g;
const keyword = (htmlStr) => {
  let out = '';
  let inCode = false;
  // split into tags and text; skip text inside <code>…</code>
  for (const part of htmlStr.split(/(<[^>]+>)/)) {
    if (part.startsWith('<')) {
      if (/^<code[\s>]/i.test(part)) inCode = true;
      else if (/^<\/code>/i.test(part)) inCode = false;
      out += part;
    } else if (inCode) {
      out += part;
    } else {
      out += part.replace(
        KW_RE,
        (m) => `<b class="kw ${m.toLowerCase().replace(/\s+/g, '-')}">${m}</b>`,
      );
    }
  }
  return out;
};

// split a requirement into a scannable summary (first sentence) + the rest
function splitReq(text) {
  const stop = text.search(/[.;](\s|$)/);
  if (stop < 0 || stop > text.length - 2) return { summary: text, rest: '' };
  return {
    summary: text.slice(0, stop + 1),
    rest: text.slice(stop + 1).trim(),
  };
}

// group divider inside a Requirements section — either ### or #### (specs nest
// the FR/SC categories one level below the "### Functional Requirements" header)
const REQ_GROUP_RE = /^#{3,4}\s+(?!#)\s*(.+?)\s*$/;
// generic category labels that just announce the list — not real sub-groups
const GENERIC_GROUP = /^(functional requirements|measurable outcomes)$/i;

function renderRequirements(blockLines) {
  // group by H3/H4 sub-headers; accumulate multi-line requirement text per item.
  const groups = [];
  let cur = { label: null, items: [], prose: [] };
  groups.push(cur);
  let item = null; // current requirement, to absorb wrapped continuation lines
  const flush = () => {
    if (item) cur.items.push(item);
    item = null;
  };
  for (const line of blockLines) {
    const hg = line.match(REQ_GROUP_RE);
    if (hg) {
      flush();
      const label = cleanHeading(hg[1]);
      // collapse a bare "Functional Requirements" announcer into the implicit
      // top group so it doesn't render as an empty header
      cur = {
        label: GENERIC_GROUP.test(label) ? null : label,
        items: [],
        prose: [],
      };
      groups.push(cur);
      continue;
    }
    const r = line.match(REQ_RE);
    if (r) {
      flush();
      item = { kind: r[1], id: `${r[1]}-${r[2]}`, text: r[3] };
    } else if (item && /^\s+\S/.test(line)) {
      item.text += ' ' + line.trim(); // indented continuation of current item
    } else if (line.trim() && !line.startsWith('<!--')) {
      flush();
      cur.prose.push(line);
    } else {
      flush();
    }
  }
  flush();

  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const kw = (t) => keyword(inline(t));

  const card = (it) => {
    const { summary, rest } = splitReq(it.text);
    const mod = (it.text.match(/\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/) || [])[1];
    const modCls = mod ? mod.toLowerCase().replace(/\s+/g, '-') : '';
    const hay = `${it.id} ${it.text}`.toLowerCase();
    return `<details class="req" data-kind="${it.kind}" data-mod="${modCls}" data-hay="${esc(hay)}">
      <summary>
        <span class="req-id ${it.kind.toLowerCase()}">${esc(it.id)}</span>
        ${mod ? `<span class="mod ${modCls}">${mod}</span>` : ''}
        <span class="req-sum">${kw(summary)}</span>
        ${rest ? '<span class="more">▸</span>' : ''}
      </summary>
      ${rest ? `<div class="req-rest">${kw(rest)}</div>` : ''}
    </details>`;
  };

  const groupHtml = groups
    .filter((g) => g.items.length || (g.label && g.prose.join('').trim()))
    .map((g) => {
      const head = g.label ? `<h4 class="req-group">${esc(g.label)}</h4>` : '';
      // Key Entities: render the definition bullets as entity cards, not prose.
      if (g.label && /key entit/i.test(g.label) && !g.items.length) {
        const entities = renderEntityCards(g.prose);
        if (entities) return `${head}${entities}`;
      }
      const prose = g.prose.join('\n').trim()
        ? `<div class="req-prose">${md.render(g.prose.join('\n'))}</div>`
        : '';
      return `${head}${prose}${g.items.map(card).join('\n')}`;
    })
    .join('\n');

  // a filter bar only makes sense when there are many items to scan
  const filter =
    total >= 6
      ? `<div class="req-filter">
          <input type="search" class="req-search" placeholder="Filter ${total} requirements…" aria-label="Filter requirements">
          <div class="req-modfilter">
            <button data-mod="" class="active">All</button>
            <button data-mod="must">MUST</button>
            <button data-mod="should">SHOULD</button>
            <button data-mod="may">MAY</button>
          </div>
          <button class="req-toggle" data-state="collapsed">Expand all</button>
          <span class="req-empty" hidden>No matches</span>
        </div>`
      : '';

  return `${filter}<div class="req-list">${groupHtml}</div>`;
}

function renderProse(blockLines) {
  const body = md.render(blockLines.join('\n'));
  return body.trim() ? body : '';
}

const SECTION_KIND = (heading) => {
  const h = heading.toLowerCase();
  if (h.includes('user scenario') || h.includes('user stories')) return 'stories';
  if (h.includes('requirement')) return 'requirements';
  if (h.includes('success crit')) return 'requirements'; // SC cards
  return 'prose';
};

// sections that should start collapsed (read-on-demand context)
const COLLAPSED = (heading) => {
  const h = heading.toLowerCase();
  return (
    h.includes('context') ||
    h.includes('clarification') ||
    h.includes('assumption') ||
    h.includes('out of scope') ||
    h.includes('implementation note') ||
    h.includes('key entit')
  );
};

const STYLES = `
:root{
  --bg:#0e1014;--panel:#151922;--panel2:#1a1f2b;--text:#e7e9ef;--muted:#98a1b2;
  --line:#272d3b;--accent:#6ea8fe;--ok:#39d39f;
  --p1:#ff6b6b;--p2:#ffb454;--p3:#7aa2ff;--p4:#b58cff;
  --fr:#6ea8fe;--sc:#39d39f;--nfr:#b58cff;--toc-w:230px;
}
@media(prefers-color-scheme:light){:root{
  --bg:#fafbfd;--panel:#fff;--panel2:#f3f6fa;--text:#1a2230;--muted:#5a6472;
  --line:#dde3ec;--accent:#2563eb;--ok:#0fa968;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.layout{display:grid;grid-template-columns:var(--toc-w) 1fr;}
nav.toc{position:sticky;top:41px;align-self:start;height:calc(100vh - 41px);overflow-y:auto;
  padding:1.4rem 1rem;border-right:1px solid var(--line);background:var(--panel);font-size:.9rem;}
nav.toc .tt{font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 .6rem;}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:.28rem .5rem;border-radius:7px;}
nav.toc a:hover{color:var(--text);background:var(--panel2);}
nav.toc a.active{color:var(--accent);background:var(--panel2);}
main{padding:2rem 2.6rem 5rem;min-width:0;max-width:1000px;}
.spec-head{margin-bottom:1.6rem;}
.spec-head h1{font-size:1.7rem;margin:0 0 .7rem;}
.head-meta{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:.85rem;}
.status{font-weight:800;font-size:.7rem;padding:.15rem .55rem;border-radius:99px;background:var(--accent);color:#001;text-transform:uppercase;letter-spacing:.04em;}
.status.draft{background:var(--p2);color:#241600;}
.status.done,.status.complete,.status.approved{background:var(--ok);color:#00231a;}
.chiplet{background:var(--panel2);border:1px solid var(--line);padding:.15rem .55rem;border-radius:99px;}
.intent{margin:.9rem 0 0;padding:.7rem .9rem;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;color:var(--muted);font-size:.92rem;}
section.sec{margin:2rem 0 0;scroll-margin-top:1rem;}
section.sec>h2{font-size:1.25rem;margin:0 0 .8rem;padding-bottom:.35rem;border-bottom:1px solid var(--line);}
details.story-card,details.sub{background:var(--panel);border:1px solid var(--line);border-radius:11px;margin:.55rem 0;overflow:hidden;}
details.story-card{border-left:3px solid var(--line);}
.story-card.pri-p1{border-left-color:var(--p1);}.story-card.pri-p2{border-left-color:var(--p2);}
.story-card.pri-p3{border-left-color:var(--p3);}.story-card.pri-p4{border-left-color:var(--p4);}
details>summary{list-style:none;cursor:pointer;}
details>summary::-webkit-details-marker{display:none;}
.story-card>summary{display:flex;gap:.55rem;align-items:center;padding:.75rem .9rem;}
.pri-badge{font-size:.66rem;font-weight:800;padding:.1rem .5rem;border-radius:99px;flex:0 0 auto;}
.pri-badge.p1{background:var(--p1);color:#240000}.pri-badge.p2{background:var(--p2);color:#241600}
.pri-badge.p3{background:var(--p3);color:#001033}.pri-badge.p4{background:var(--p4);color:#190033}
.story-n{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;color:var(--muted);font-weight:700;}
.story-title{font-weight:650;flex:1;min-width:0;}
.more{color:var(--muted);font-size:.72rem;transition:transform .15s;}
details[open] .more{transform:rotate(90deg);}
.story-body,.sub-body{padding:.2rem 1rem 1rem;border-top:1px solid var(--line);font-size:.93rem;}
.story-body strong{color:var(--text);}
details.sub>summary{padding:.7rem .9rem;font-weight:650;color:var(--muted);}
h4.req-group{font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:1.3rem 0 .5rem;}
/* requirement filter bar */
.req-filter{position:sticky;top:41px;z-index:5;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;
  padding:.5rem;margin:0 0 .6rem;background:color-mix(in srgb,var(--bg) 90%,transparent);
  backdrop-filter:blur(6px);border:1px solid var(--line);border-radius:10px;}
.req-search{flex:1;min-width:160px;background:var(--panel2);border:1px solid var(--line);color:var(--text);
  border-radius:8px;padding:.4rem .7rem;font:inherit;font-size:.86rem;}
.req-modfilter{display:flex;gap:.25rem;}
.req-modfilter button,.req-toggle{background:var(--panel2);border:1px solid var(--line);color:var(--muted);
  border-radius:7px;padding:.3rem .6rem;font-size:.76rem;cursor:pointer;font-weight:650;}
.req-modfilter button.active{background:var(--accent);color:#001;border-color:var(--accent);}
.req-modfilter button:hover,.req-toggle:hover{color:var(--text);}
.req-empty{color:var(--muted);font-size:.85rem;}
/* requirement cards (collapsible) */
details.req{border:1px solid var(--line);border-radius:9px;margin:.35rem 0;background:var(--panel);overflow:hidden;}
details.req>summary{list-style:none;cursor:pointer;display:flex;gap:.6rem;align-items:baseline;padding:.5rem .7rem;}
details.req>summary::-webkit-details-marker{display:none;}
details.req>summary:hover{background:var(--panel2);}
details.req[open]>summary{background:var(--panel2);}
.req-id{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;font-weight:800;padding:.12rem .5rem;border-radius:6px;flex:0 0 auto;align-self:center;}
.req-id.fr{background:rgba(110,168,254,.16);color:var(--fr);}
.req-id.sc{background:rgba(57,211,159,.16);color:var(--sc);}
.req-id.nfr{background:rgba(181,140,255,.16);color:var(--nfr);}
.mod{font-size:.6rem;font-weight:800;letter-spacing:.03em;padding:.08rem .35rem;border-radius:5px;flex:0 0 auto;align-self:center;}
.mod.must,.mod.must-not{background:rgba(255,107,107,.16);color:#ff8a8a;}
.mod.should,.mod.should-not{background:rgba(255,180,84,.16);color:#ffb454;}
.mod.may{background:rgba(122,162,255,.16);color:var(--p3);}
.req-sum{flex:1;min-width:0;font-size:.91rem;}
.req-rest{padding:.2rem .7rem .6rem 2.2rem;font-size:.9rem;color:var(--muted);border-top:1px solid var(--line);}
.req-sum .kw,.req-rest .kw{color:var(--accent);font-weight:800;}
.req-prose{font-size:.9rem;color:var(--muted);margin:.4rem 0;}
/* edge case cards */
.edge-block{margin:1.4rem 0 .5rem;}
.edge-head{font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--p2);font-weight:800;margin:0 0 .5rem;}
details.edge{border:1px solid var(--line);border-left:3px solid var(--p2);border-radius:9px;margin:.35rem 0;background:var(--panel);overflow:hidden;}
details.edge>summary{list-style:none;cursor:pointer;display:flex;gap:.6rem;align-items:baseline;padding:.55rem .75rem;}
details.edge>summary::-webkit-details-marker{display:none;}
details.edge>summary:hover{background:var(--panel2);}
details.edge[open]>summary{background:var(--panel2);}
.edge-q{flex:0 0 1.3rem;width:1.3rem;height:1.3rem;border-radius:50%;background:rgba(255,180,84,.18);color:var(--p2);
  display:inline-grid;place-items:center;font-weight:800;font-size:.8rem;align-self:center;}
.edge-t{flex:1;min-width:0;font-weight:600;font-size:.92rem;}
.edge-b{padding:.2rem .75rem .65rem 2.65rem;font-size:.9rem;color:var(--muted);border-top:1px solid var(--line);}
/* Key Entities -> definition card grid */
.entity-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.6rem;margin:.4rem 0;}
.entity{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.65rem .8rem;border-top:2px solid var(--accent);}
.entity-name{font-weight:700;font-size:.92rem;margin-bottom:.3rem;}
.entity-desc{font-size:.86rem;color:var(--muted);line-height:1.5;}
.entity-desc code{font-size:.82em;}
details.prose-sec{background:var(--panel);border:1px solid var(--line);border-radius:11px;margin:.55rem 0;}
details.prose-sec>summary{padding:.8rem 1rem;font-weight:700;}
.prose-body{padding:0 1.1rem 1rem;font-size:.93rem;}
code{background:var(--panel2);padding:.1em .35em;border-radius:4px;font-size:.86em;font-family:ui-monospace,Menlo,monospace;}
table{border-collapse:collapse;width:100%;margin:.8rem 0;font-size:.9rem;}
th,td{border:1px solid var(--line);padding:.45rem .6rem;text-align:left;}
th{background:var(--panel2);}
blockquote{margin:.8rem 0;padding:.4rem .9rem;border-left:3px solid var(--accent);background:var(--panel2);color:var(--muted);border-radius:0 6px 6px 0;}
ol li,ul li{margin:.3rem 0;}
@media(max-width:820px){.layout{grid-template-columns:1fr;}nav.toc{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line);}main{padding:1.4rem 1.2rem;}.entity-grid{grid-template-columns:1fr;}}
${NAV_STYLES}`;

const SCRIPT = `
const links=[...document.querySelectorAll('nav.toc a')];
const map=new Map(links.map(a=>[a.getAttribute('href').slice(1),a]));
const obs=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting){
  links.forEach(a=>a.classList.remove('active'));const a=map.get(e.target.id);if(a)a.classList.add('active');}}},
  {rootMargin:'0px 0px -75% 0px'});
document.querySelectorAll('section.sec').forEach(s=>obs.observe(s));

// requirement filter: text search + MUST/SHOULD/MAY + expand/collapse all
document.querySelectorAll('.req-filter').forEach(bar=>{
  const list=bar.parentElement.querySelector('.req-list');
  const reqs=[...list.querySelectorAll('details.req')];
  const search=bar.querySelector('.req-search');
  const empty=bar.querySelector('.req-empty');
  const toggle=bar.querySelector('.req-toggle');
  let mod='';
  function apply(){
    const q=(search.value||'').trim().toLowerCase();
    let shown=0;
    for(const r of reqs){
      const okq=!q||r.dataset.hay.includes(q);
      const okm=!mod||r.dataset.mod===mod||r.dataset.mod.startsWith(mod);
      const vis=okq&&okm;
      r.style.display=vis?'':'none';
      if(vis)shown++;
    }
    // hide group headers with no visible items
    list.querySelectorAll('h4.req-group').forEach(h=>{
      let n=h.nextElementSibling,any=false;
      while(n&&!n.matches('h4.req-group')){if(n.matches('details.req')&&n.style.display!=='none')any=true;n=n.nextElementSibling;}
      h.style.display=any?'':'none';
    });
    empty.hidden=shown>0;
  }
  search.addEventListener('input',apply);
  bar.querySelectorAll('.req-modfilter button').forEach(b=>b.addEventListener('click',()=>{
    bar.querySelectorAll('.req-modfilter button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');mod=b.dataset.mod;apply();
  }));
  toggle.addEventListener('click',()=>{
    const expand=toggle.dataset.state==='collapsed';
    reqs.forEach(r=>{if(r.style.display!=='none')r.open=expand;});
    toggle.dataset.state=expand?'expanded':'collapsed';
    toggle.textContent=expand?'Collapse all':'Expand all';
  });
});
`;

export function renderSpecDashboard(src, { title, nav } = {}) {
  const parsed = parse(src);
  const docTitle = title || parsed.title;

  const navItems = [];
  const bodyParts = [];

  for (const sec of parsed.sections) {
    const id = slug(sec.heading);
    const kind = SECTION_KIND(sec.heading);
    navItems.push(`<a href="#${id}">${esc(sec.heading)}</a>`);

    let inner;
    if (kind === 'stories') inner = renderStories(sec.lines);
    else if (kind === 'requirements') inner = renderRequirements(sec.lines);
    else inner = renderProse(sec.lines);

    if (!inner || !inner.trim()) {
      // still emit the section header so nav anchor resolves
      inner = '<p class="req-prose">—</p>';
    }

    if (kind === 'prose' && COLLAPSED(sec.heading)) {
      bodyParts.push(
        `<section class="sec" id="${id}"><h2>${esc(sec.heading)}</h2>
         <details class="prose-sec"><summary>Show ${esc(sec.heading)}</summary><div class="prose-body">${inner}</div></details>
         </section>`,
      );
    } else {
      bodyParts.push(
        `<section class="sec" id="${id}"><h2>${esc(sec.heading)}</h2>${inner}</section>`,
      );
    }
  }

  const m = parsed.meta;
  const statusCls = (m.status || '').toLowerCase().replace(/[^a-z]/g, '');
  const headMeta = [
    m.status ? `<span class="status ${statusCls}">${esc(m.status)}</span>` : '',
    m.branch ? `<span class="chiplet">${inline(m.branch)}</span>` : '',
    m.created ? `<span class="chiplet">${esc(m.created)}</span>` : '',
  ].join('');
  const intent = m.input ? `<div class="intent">${inline(m.input)}</div>` : '';

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
<nav class="toc"><p class="tt">Spec</p>${navItems.join('\n')}</nav>
<main>
  <div class="spec-head">
    <h1>${esc(docTitle)}</h1>
    <div class="head-meta">${headMeta}</div>
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
