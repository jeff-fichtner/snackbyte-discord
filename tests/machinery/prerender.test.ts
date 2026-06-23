// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

describe('static build prerendering', () => {
  it('emits HTML with rendered content, not an empty root element', () => {
    execFileSync('node', ['scripts/build.mjs'], { stdio: 'ignore' });

    const html = readFileSync(distIndex, 'utf8');
    // The placeholder must have been replaced with real rendered markup — a
    // structural check independent of whatever the app's content actually is.
    expect(html).not.toContain('<!--app-html-->');
    const rootContent = html.match(/<div id="root">(.*?)<\/div>/s)?.[1] ?? '';
    expect(rootContent.trim().length).toBeGreaterThan(0);
    expect(rootContent).toContain('<'); // contains rendered HTML elements, not just text
  });
});
