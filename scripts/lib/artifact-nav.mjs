// artifact-nav.mjs — shared cross-artifact navigation bar.
//
// Every generated view (spec dashboard, plan view, tasks roadmap, readable)
// renders this bar so you can move between the sibling artifacts of one feature.
// The caller passes `siblings` (a map of name -> bool for which .md files exist
// alongside) and `current` (the active artifact key). Links point at the
// sibling .html. Returns both the CSS and the markup so each view can inline it
// without a build step.

// Ordered list of the artifacts we surface, with display labels.
const ARTIFACTS = [
  { key: 'spec', file: 'spec.html', label: 'Spec' },
  { key: 'plan', file: 'plan.html', label: 'Plan' },
  { key: 'tasks', file: 'tasks.html', label: 'Tasks' },
  { key: 'research', file: 'research.html', label: 'Research' },
  { key: 'data-model', file: 'data-model.html', label: 'Data Model' },
  { key: 'quickstart', file: 'quickstart.html', label: 'Quickstart' },
];

export const NAV_STYLES = `
.artifact-nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:.3rem;
  padding:.5rem .9rem;background:color-mix(in srgb,var(--bg) 86%,transparent);
  backdrop-filter:saturate(140%) blur(8px);border-bottom:1px solid var(--line);
  font-size:.85rem;flex-wrap:wrap;}
.artifact-nav .an-home{font-weight:700;color:var(--muted);margin-right:.4rem;text-decoration:none;}
.artifact-nav .an-home:hover{color:var(--text);}
.artifact-nav a.an-link{text-decoration:none;color:var(--muted);padding:.28rem .7rem;border-radius:8px;
  border:1px solid transparent;}
.artifact-nav a.an-link:hover{color:var(--text);background:var(--panel2);}
.artifact-nav a.an-link.current{color:var(--accent);border-color:var(--line);background:var(--panel);
  font-weight:650;cursor:default;}
.artifact-nav .an-spacer{flex:1;}
.artifact-nav .an-feat{color:var(--muted);font-size:.78rem;font-family:ui-monospace,Menlo,monospace;}
`;

// feature is an optional label (e.g. "003-env-manifest") shown on the right.
export function navBar({ siblings = {}, current, feature } = {}) {
  const links = ARTIFACTS.filter((a) => siblings[a.key] || a.key === current)
    .map((a) => {
      const cls = a.key === current ? 'an-link current' : 'an-link';
      if (a.key === current) return `<span class="${cls}">${a.label}</span>`;
      return `<a class="${cls}" href="${a.file}">${a.label}</a>`;
    })
    .join('');
  const feat = feature ? `<span class="an-feat">${feature}</span>` : '';
  return `<nav class="artifact-nav">${links}<span class="an-spacer"></span>${feat}</nav>`;
}
