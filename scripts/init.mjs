/**
 * One-time spin-up resolver. Bakes the app into a single deploy mode and removes all
 * template scaffolding — including itself. Run once, right after creating a repo from
 * this template:
 *
 *   node scripts/init.mjs --mode=<static|server> --render=<prerender|dynamic> [--name=<app-name>]
 *
 * Both --mode and --render are required (the resolver exits non-zero without either).
 * It is intentionally specific and non-defensive: it runs once against the pristine
 * template (a known state), then deletes itself, so it never sees a modified repo.
 *
 *   static → serves a frontend with no API. Deletes src/routes and strips the
 *            server-only marker blocks (which include the dev API proxy in
 *            vite.config.ts and the dev API process in scripts/dev.mjs). (An
 *            Express server still serves the built files.)
 *   server → serves the frontend AND an Express API under /api.
 *
 *   prerender → content rendered to real HTML at build time.
 *   dynamic   → client-side rendering; no prerender step.
 *
 * After it runs there is no "mode"/"render" concept left: the app simply is what it
 * is. Switching later is a documented code edit (see the template's docs), not a flag.
 */
import { readFileSync, writeFileSync, rmSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = (p) => resolve(root, p);

// ---- args ------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const USAGE =
  'Usage: node scripts/init.mjs --mode=<static|server> --render=<prerender|dynamic> --name=<repo-slug>';
const mode = args.mode;
const render = args.render;
if (mode !== 'static' && mode !== 'server') {
  console.error(USAGE);
  process.exit(1);
}
if (render !== 'prerender' && render !== 'dynamic') {
  console.error(USAGE);
  process.exit(1);
}
// --name is required: without it the app would silently keep the template's name
// (snackbyte-base) in package.json, the README, the lockfile, and the page title.
if (typeof args.name !== 'string' || args.name.trim() === '') {
  console.error('Error: --name is required (the repo slug, e.g. --name=my-app).');
  console.error(USAGE);
  process.exit(1);
}

// ---- marker resolution -----------------------------------------------------
// Resolve `SPINUP:<axis>-only` blocks: keep the code (strip just the marker comments)
// when the app is that variant, or delete the whole block when it isn't.
function resolveMarkers(rel, axis, keep) {
  const file = path(rel);
  if (!existsSync(file)) return;
  let text = readFileSync(file, 'utf8');
  const start = new RegExp(`[ \\t]*(?://|#)\\s*SPINUP:${axis}:start.*\\n`, 'g');
  const end = new RegExp(`[ \\t]*(?://|#)\\s*SPINUP:${axis}:end.*\\n`, 'g');
  const block = new RegExp(
    `[ \\t]*(?://|#)\\s*SPINUP:${axis}:start[\\s\\S]*?SPINUP:${axis}:end.*\\n`,
    'g',
  );
  text = keep ? text.replace(start, '').replace(end, '') : text.replace(block, '');
  writeFileSync(file, text);
}

// server-only axis (across these files); prerender-only axis (in build.mjs).
for (const rel of ['src/server.ts', 'vite.config.ts', 'scripts/dev.mjs']) {
  resolveMarkers(rel, 'server-only', mode === 'server');
}
resolveMarkers('scripts/build.mjs', 'prerender-only', render === 'prerender');

// ---- static-only deletions -------------------------------------------------
if (mode === 'static') {
  rmSync(path('src/routes'), { recursive: true, force: true });
}

// ---- dynamic-only deletions (no prerender step) ----------------------------
if (render === 'dynamic') {
  rmSync(path('src/web/prerender.ts'), { force: true });
  rmSync(path('scripts/prerender.mjs'), { force: true });
}

// ---- re-tier tests ---------------------------------------------------------
// The template proves its own plumbing in tests/machinery (deleted now). The app
// keeps tests/app: an example plus the smoke test matching its mode. Vitest is
// pointed at tests/app.
rmSync(path('tests/machinery'), { recursive: true, force: true });
if (mode === 'server') {
  rmSync(path('tests/app/static-smoke.test.ts'), { force: true });
} else {
  rmSync(path('tests/app/server-smoke.test.ts'), { force: true });
}
{
  const cfg = path('vite.config.ts');
  let text = readFileSync(cfg, 'utf8');
  text = text.replace(/tests\/machinery\//g, 'tests/app/');
  writeFileSync(cfg, text);
}

// ---- de-template the release workflow header -------------------------------
// The CI workflow (.github/workflows/ci-cd.yml) is always-on and identical for every app —
// it just needs its header de-templated so the resolved repo carries no template/spin-up/init
// references (a fingerprint, and a dangling reference to this script after it self-deletes).
// Nothing about the release LOGIC changes on spin-up: the version is derived from git tags and
// nothing is committed back, with or without a dev branch.
{
  const wf = path('.github/workflows/ci-cd.yml');
  let text = readFileSync(wf, 'utf8');
  // Replace the template-authored header (everything before `name:`) with an app-appropriate
  // version — no template/spin-up/init references. Anchored on `name:`.
  const appHeader =
    [
      '# Validate, version, and tag — the branch selects the environment.',
      '#',
      '#   - dev  -> staging      (tag vMAJOR.MINOR.PATCH-dev)',
      '#   - main -> production   (tag vMAJOR.MINOR.PATCH)',
      '#',
      '# The version PATCH is derived from git tags, never committed: package.json holds only',
      '# MAJOR.MINOR, and CI creates + pushes a tag only (no commit, no branch push). A PR is',
      '# blocked until `npm run check:all` passes, and the gate is re-run on the push before any',
      '# tag is created. The deploy job is wired per environment (see DEPLOY.md).',
      '',
    ].join('\n') + '\n';
  const nameIdx = text.indexOf('\nname:');
  if (nameIdx !== -1) {
    text = appHeader + text.slice(nameIdx + 1);
  }
  writeFileSync(wf, text);
}

// ---- rename the package ----------------------------------------------------
if (typeof args.name === 'string') {
  const pkgPath = path('package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = args.name;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---- remove the init script line + template description, reset version -----
// The app starts its own version line at MAJOR.MINOR 0.1 (not the template's version).
// package.json holds only MAJOR.MINOR; the PATCH is derived from git tags by CI, so the first
// push to main tags v0.1.0. Bump MAJOR.MINOR by hand for a meaningful release.
const pkgPath = path('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
delete pkg.scripts.init;
// Derive a placeholder description from the name rather than blanking it (the app owner
// can refine it, but a blank description is worse than a sensible stub).
pkg.description = `${pkg.name} — a snackbyte app.`;
pkg.version = '0.1';
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Sync package-lock.json's name/version to match — otherwise the lockfile keeps the
// template's name and version (a surviving fingerprint, and a stale version number).
{
  const lockPath = path('package-lock.json');
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.name = pkg.name;
    lock.version = pkg.version;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].name = pkg.name;
      lock.packages[''].version = pkg.version;
    }
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
}

// ---- swap in the forward-facing app README, drop template docs -------------
// The app gets its own README (no template/skeleton language); the template README
// and this handoff guide are removed.
const appName = typeof args.name === 'string' ? args.name : pkg.name;
const appReadme = readFileSync(path('README.app.md'), 'utf8').replace(/APP_NAME/g, appName);
writeFileSync(path('README.md'), appReadme);
rmSync(path('README.app.md'), { force: true });
for (const rel of ['SPIN-UP.md']) {
  if (existsSync(path(rel))) rmSync(path(rel), { force: true });
}

// Set the page <title> to the app name (the template ships a placeholder "App").
{
  const htmlPath = path('src/web/index.html');
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace(/<title>App<\/title>/, `<title>${appName}</title>`);
  writeFileSync(htmlPath, html);
}

// Leave the app's spec-driven-dev state exactly as a fresh `specify init` would: the
// Spec Kit tooling (.specify/, .claude/) stays, but the template's own constitution
// and specs are removed — they were about building the template, not this app. The
// app's first step is to run /speckit-constitution, then /speckit-specify.
rmSync(path('.specify/memory/constitution.md'), { force: true });
rmSync(path('specs'), { recursive: true, force: true });
mkdirSync(path('specs'), { recursive: true });
writeFileSync(path('specs/.gitkeep'), '');
// feature.json tracks the active feature; the template's points at a spec we just
// deleted. A fresh `specify init` has none, so drop it — the first /speckit-specify
// recreates it for the app's own first feature.
rmSync(path('.specify/feature.json'), { force: true });

// Clean up CLAUDE.md for the app: remove the template guard (it's a normal app now,
// meant to be edited), and rewrite the SPECKIT block — the template pointed it at its
// own plan (specs/001-template-skeleton/plan.md), which we just deleted, leaving a
// dangling reference. The result matches a fresh `specify init` state.
{
  const claudePath = path('CLAUDE.md');
  if (existsSync(claudePath)) {
    const generic =
      '<!-- SPECKIT START -->\n' +
      'This project uses spec-driven development (GitHub Spec Kit). Nothing is spec’d\n' +
      'yet — run `/speckit-constitution` to establish this app’s principles, then\n' +
      '`/speckit-specify` to define the first feature. Plans live under `specs/`.\n' +
      '<!-- SPECKIT END -->\n';
    let text = readFileSync(claudePath, 'utf8');
    text = text.replace(
      /<!-- TEMPLATE-GUARD START -->[\s\S]*?<!-- TEMPLATE-GUARD END -->\n?\n?/,
      '',
    );
    text = text.replace(/<!-- SPECKIT START -->[\s\S]*?<!-- SPECKIT END -->\n?/, generic);
    writeFileSync(claudePath, text);
  }
}

// ---- tidy formatting -------------------------------------------------------
// Deleting marker blocks can leave stray blank lines; reformat so the quality gate
// passes cleanly on the resolved app.
const prettierBin = path(`node_modules/.bin/prettier${process.platform === 'win32' ? '.cmd' : ''}`);
spawnSync(
  prettierBin,
  [
    '--config',
    'config/.prettierrc.json',
    '--ignore-path',
    'config/.prettierignore',
    '--write',
    'src/**/*.{ts,tsx}',
    'scripts/**/*.mjs',
    'vite.config.ts',
  ],
  { cwd: root, stdio: 'ignore' },
);

console.log(`Initialized as a ${mode} / ${render} app named "${appName}".`);
console.log('Removed template scaffolding. This repo is now your app.');

// ---- print the next step: authorize CI to push tags ------------------------
// The release workflow tags main on the first push, which needs the repo's Actions
// permission set to write. Print the exact command, with the repo slug filled in from
// the git remote when available (falls back to a placeholder otherwise).
{
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout?.trim();
  const match = remote?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  const slug = match ? match[1] : '<owner>/<repo>';
  console.log('');
  console.log('Next:');
  console.log('  1. Verify:  npm run check:all  &&  npm run dev');
  console.log('  2. Authorize CI to push version tags (before your first push to main):');
  console.log(
    `       gh api -X PUT repos/${slug}/actions/permissions/workflow -f default_workflow_permissions=write`,
  );
  console.log('  3. Commit and push to main (the first push derives and tags v0.1.0).');
}

// ---- self-delete (last) ----------------------------------------------------
unlinkSync(fileURLToPath(import.meta.url));
