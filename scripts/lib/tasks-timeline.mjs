// tasks-timeline.mjs — render a Spec Kit tasks.md as a hybrid roadmap view.
//
// Top: a compact horizontal roadmap of phases as milestone chips (progress ring,
// title, MVP/priority badges, done/total). Click a chip to drill into that
// phase's tasks below — a readable vertical list with checkbox state, parallel
// (∥) and story (US#) tags, and expandable full descriptions. One scroll axis
// at a time. Supporting ### sections (Notes/Dependencies) collapse at the end.
//
// Exports renderTasksTimeline(src, { title, nav }) -> full HTML string.

import MarkdownIt from 'markdown-it';
import { navBar, NAV_STYLES } from './artifact-nav.mjs';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const inline = (s) => md.renderInline(s);
const esc = (s) => md.utils.escapeHtml(s);

const PHASE_RE = /^##\s+Phase\s+([\w.]+):\s*(.+?)\s*$/;
const TASK_RE = /^- \[([ Xx])\]\s+(T[\w]+)\s*((?:\[[^\]]+\]\s*)*)(.*)$/;
const SUPPORT_RE = /^(Notes|Dependencies|Phase Dependencies|Parallel|Incremental|MVP|Checkpoint)/i;

function parsePhaseMeta(raw) {
  let title = raw;
  let mvp = false;
  let priority = null;
  if (/🎯\s*MVP/.test(title)) {
    mvp = true;
    title = title.replace(/🎯\s*MVP/, '').trim();
  }
  const pm = title.match(/\((?:Priority:\s*)?(P\d)\)/);
  if (pm) {
    priority = pm[1];
    title = title.replace(/\((?:Priority:\s*)?P\d\)/, '').trim();
  }
  return { title: title.replace(/[—-]\s*$/, '').trim(), mvp, priority };
}

// Detect whether a tasks.md is structured enough to render as a roadmap.
// Falls back to the generic readable view when it has no phases. The line REs
// are single-line anchored; test them per line (a multiline-flag copy would be
// stateful with the global-less REs but cleaner to just scan lines here).
export function looksLikeTasks(src) {
  const lines = src.split('\n');
  return lines.some((l) => PHASE_RE.test(l)) && lines.some((l) => TASK_RE.test(l));
}

function parse(src) {
  const lines = src.split('\n');
  const phases = [];
  const trailing = [];
  let cur = null;
  let inTrailing = false;

  for (const line of lines) {
    const pm = line.match(PHASE_RE);
    if (pm) {
      inTrailing = false;
      cur = { num: pm[1], ...parsePhaseMeta(pm[2]), items: [] };
      phases.push(cur);
      continue;
    }
    const sm = line.match(/^###\s+(.+?)\s*$/);
    if (sm) {
      const label = sm[1].replace(/[`*]/g, '').trim();
      if (SUPPORT_RE.test(label) || !cur) {
        inTrailing = true;
        trailing.push({ label, body: [] });
        continue;
      }
      cur.items.push({ kind: 'group', label });
      continue;
    }
    if (inTrailing && trailing.length) {
      trailing[trailing.length - 1].body.push(line);
      continue;
    }
    const tm = line.match(TASK_RE);
    if (tm && cur) {
      cur.items.push({
        kind: 'task',
        done: tm[1].toLowerCase() === 'x',
        id: tm[2],
        parallel: /\[P\]/.test(tm[3] || ''),
        story: (tm[3].match(/\[(US\d+)\]/) || [])[1] || null,
        desc: tm[4].trim(),
      });
    }
  }

  for (const p of phases) {
    const ts = p.items.filter((i) => i.kind === 'task');
    p._all = ts.length;
    p._done = ts.filter((t) => t.done).length;
  }
  return { phases, trailing };
}

const pct = (d, a) => (a ? Math.round((d / a) * 100) : 0);

function ring(d, a) {
  const p = pct(d, a);
  const r = 15;
  const c = 2 * Math.PI * r;
  const off = c * (1 - p / 100);
  const full = a && d === a;
  return `<svg class="ring ${full ? 'full' : ''}" width="38" height="38" viewBox="0 0 38 38">
    <circle cx="19" cy="19" r="${r}" class="ring-bg"/>
    <circle cx="19" cy="19" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
    <text x="19" y="22" class="ring-num">${full ? '✓' : p + '%'}</text>
  </svg>`;
}

function chip(p, i) {
  const status = p._all && p._done === p._all ? 'complete' : p._done > 0 ? 'active' : 'pending';
  const badges = [
    p.mvp ? '<span class="pb mvp">MVP</span>' : '',
    p.priority ? `<span class="pb pri ${p.priority.toLowerCase()}">${p.priority}</span>` : '',
  ].join('');
  return `<button class="chip ${status}" data-phase="${i}" aria-pressed="${i === 0}">
    <span class="connector"></span>
    ${ring(p._done, p._all)}
    <span class="chip-text">
      <span class="cnum">PHASE ${esc(p.num)}</span>
      <span class="ctitle">${esc(p.title)}</span>
      <span class="cmeta">${badges}<span class="ccount">${p._done}/${p._all}</span></span>
    </span>
  </button>`;
}

function taskRow(t) {
  const first = t.desc.search(/[.;](\s|$)/);
  const summary = first > 0 ? t.desc.slice(0, first + 1) : t.desc;
  const more = t.desc.length > summary.length + 1;
  return `<details class="task ${t.done ? 'done' : 'todo'}">
    <summary>
      <span class="check">${t.done ? '✓' : ''}</span>
      <span class="tid">${esc(t.id)}</span>
      ${t.parallel ? '<span class="t par" title="parallel">∥</span>' : ''}
      ${t.story ? `<span class="t story">${t.story}</span>` : ''}
      <span class="sum">${inline(summary)}</span>
      ${more ? '<span class="more">▸</span>' : ''}
    </summary>
    ${more ? `<div class="full">${inline(t.desc)}</div>` : ''}
  </details>`;
}

function panel(p, i) {
  const body = p.items
    .map((it) => (it.kind === 'group' ? `<h4 class="grp">${esc(it.label)}</h4>` : taskRow(it)))
    .join('\n');
  const badges = [
    p.mvp ? '<span class="pb mvp">🎯 MVP</span>' : '',
    p.priority ? `<span class="pb pri ${p.priority.toLowerCase()}">${p.priority}</span>` : '',
  ].join('');
  return `<div class="panel" data-panel="${i}" ${i === 0 ? '' : 'hidden'}>
    <div class="panel-head">
      <h2>Phase ${esc(p.num)} · ${esc(p.title)}</h2>
      <div class="ph-meta">${badges}
        <span class="ph-bar"><span style="width:${pct(p._done, p._all)}%"></span></span>
        <span class="ph-count">${p._done}/${p._all} done</span>
      </div>
    </div>
    <div class="panel-body">${body}</div>
  </div>`;
}

const STYLES = `
:root{
  --bg:#0e1014;--panel:#151922;--panel2:#1a1f2b;--text:#e7e9ef;--muted:#98a1b2;
  --line:#272d3b;--accent:#6ea8fe;--done:#39d39f;--pending:#3a4150;
  --p1:#ff6b6b;--p2:#ffb454;--p3:#7aa2ff;--p4:#b58cff;
}
@media(prefers-color-scheme:light){:root{
  --bg:#fafbfd;--panel:#fff;--panel2:#f3f6fa;--text:#1a2230;--muted:#5a6472;
  --line:#dde3ec;--accent:#2563eb;--done:#0fa968;--pending:#cdd5e0;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.wrap{max-width:1020px;margin:0 auto;padding:1.8rem 1.5rem 4rem;}
h1{margin:0 0 .7rem;font-size:1.6rem;}
.summary-row{display:flex;gap:1rem;align-items:center;color:var(--muted);font-size:.88rem;flex-wrap:wrap;margin-bottom:1.4rem;}
.obar{position:relative;height:8px;width:min(380px,42vw);background:var(--pending);border-radius:99px;overflow:hidden;}
.obar span{position:absolute;inset:0 auto 0 0;background:var(--done);}
.roadmap{display:flex;gap:0;overflow-x:auto;padding:.4rem .2rem 1.3rem;}
.roadmap::-webkit-scrollbar{height:8px}.roadmap::-webkit-scrollbar-thumb{background:var(--line);border-radius:99px}
.chip{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:.6rem;
  background:transparent;border:none;cursor:pointer;color:var(--text);
  padding:.4rem 1.1rem .4rem 0;text-align:left;font:inherit;}
.connector{position:absolute;top:19px;left:19px;right:-1px;height:2px;background:var(--line);z-index:0;}
.chip:last-child .connector{display:none;}
.ring{flex:0 0 38px;z-index:1;}
.ring-bg{fill:none;stroke:var(--pending);stroke-width:3;}
.ring-fg{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;
  transform:rotate(-90deg);transform-origin:center;transition:stroke-dashoffset .4s;}
.chip.complete .ring-fg{stroke:var(--done);}
.chip.pending .ring-fg{stroke:var(--pending);}
.ring-num{fill:var(--text);font-size:9px;font-weight:700;text-anchor:middle;}
.ring.full .ring-num{fill:var(--done);font-size:13px;}
.chip-text{display:flex;flex-direction:column;line-height:1.2;min-width:118px;max-width:180px;}
.cnum{font-size:.6rem;letter-spacing:.08em;color:var(--muted);font-weight:700;}
.ctitle{font-size:.84rem;font-weight:600;margin:.1rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cmeta{display:flex;gap:.3rem;align-items:center;}
.ccount{font-size:.7rem;color:var(--muted);font-variant-numeric:tabular-nums;}
.chip[aria-pressed="true"]::after{content:"";position:absolute;left:8px;right:14px;bottom:-2px;height:2px;background:var(--accent);border-radius:2px;}
.chip:hover .ctitle{color:var(--accent);}
.pb{font-size:.62rem;font-weight:800;padding:.05rem .4rem;border-radius:99px;}
.pb.mvp{background:#ffd76b;color:#3a2c00;}
.pb.pri.p1{background:var(--p1);color:#240000}.pb.pri.p2{background:var(--p2);color:#241600}
.pb.pri.p3{background:var(--p3);color:#001033}.pb.pri.p4{background:var(--p4);color:#190033}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:1.1rem 1.2rem 1.3rem;}
.panel-head{border-bottom:1px solid var(--line);padding-bottom:.7rem;margin-bottom:.6rem;}
.panel-head h2{margin:0 0 .5rem;font-size:1.2rem;}
.ph-meta{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;}
.ph-bar{position:relative;height:7px;width:160px;background:var(--pending);border-radius:99px;overflow:hidden;}
.ph-bar span{position:absolute;inset:0 auto 0 0;background:var(--done);}
.ph-count{font-size:.8rem;color:var(--muted);}
h4.grp{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:1.1rem 0 .3rem;}
details.task{border-bottom:1px solid var(--line);}
details.task:last-child{border-bottom:none;}
details.task>summary{list-style:none;cursor:pointer;display:flex;gap:.55rem;align-items:baseline;padding:.5rem .3rem;border-radius:7px;}
details.task>summary::-webkit-details-marker{display:none;}
details.task>summary:hover{background:var(--panel2);}
details.task[open]>summary{background:var(--panel2);}
.check{flex:0 0 16px;width:16px;height:16px;border-radius:50%;border:2px solid var(--pending);
  display:inline-grid;place-items:center;font-size:.6rem;color:var(--bg);align-self:center;}
.task.done .check{background:var(--done);border-color:var(--done);}
.task.done .sum{color:var(--muted);}
.tid{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;color:var(--accent);font-weight:700;flex:0 0 auto;}
.t{font-size:.64rem;font-weight:700;padding:.04rem .38rem;border-radius:99px;flex:0 0 auto;align-self:center;}
.t.par{background:var(--panel2);border:1px solid var(--line);color:var(--muted);}
.t.story{background:rgba(110,168,254,.18);color:var(--accent);}
.sum{flex:1;min-width:0;}
.more{color:var(--muted);font-size:.7rem;align-self:center;transition:transform .15s;}
details.task[open] .more{transform:rotate(90deg);}
.full{padding:.3rem .5rem .6rem 2.3rem;font-size:.92rem;color:var(--text);border-left:2px solid var(--line);margin:0 0 .5rem 1rem;}
code{background:var(--panel2);padding:.1em .35em;border-radius:4px;font-size:.86em;font-family:ui-monospace,Menlo,monospace;}
details.trailing{margin-top:1.8rem;border:1px solid var(--line);border-radius:11px;background:var(--panel);}
details.trailing>summary{padding:.85rem 1rem;font-weight:700;color:var(--muted);cursor:pointer;}
.tb{padding:0 1.2rem 1rem;font-size:.92rem;}
`;

const SCRIPT = `
const chips=[...document.querySelectorAll('.chip')];
const panels=[...document.querySelectorAll('.panel')];
function select(i){
  chips.forEach(c=>c.setAttribute('aria-pressed', String(c.dataset.phase===i)));
  panels.forEach(p=>{p.hidden = p.dataset.panel!==i;});
}
chips.forEach(c=>c.addEventListener('click',()=>select(c.dataset.phase)));
`;

export function renderTasksTimeline(src, { title, nav } = {}) {
  const { phases, trailing } = parse(src);
  const totalAll = phases.reduce((a, p) => a + p._all, 0);
  const totalDone = phases.reduce((a, p) => a + p._done, 0);
  const docTitle = title || 'Tasks';

  const trailingHtml = trailing.length
    ? `<details class="trailing"><summary>Notes, dependencies &amp; delivery</summary>
       <div class="tb">${md.render(
         trailing.map((t) => `### ${t.label}\n${t.body.join('\n')}`).join('\n\n'),
       )}</div></details>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(docTitle)}</title>
<style>${STYLES}${NAV_STYLES}</style>
</head>
<body>
${nav ? navBar(nav) : ''}
<div class="wrap">
<h1>${esc(docTitle)}</h1>
<div class="summary-row">
  <div class="obar"><span style="width:${pct(totalDone, totalAll)}%"></span></div>
  <span>${pct(totalDone, totalAll)}% · ${totalDone}/${totalAll} tasks · ${phases.length} phases</span>
</div>
<div class="roadmap">
${phases.map(chip).join('\n')}
</div>
<div class="panels">
${phases.map(panel).join('\n')}
</div>
${trailingHtml}
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
