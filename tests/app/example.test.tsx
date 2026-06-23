import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from '../../src/web/App';

// Example app test. Replace with tests for your real components and pages.
describe('App', () => {
  it('renders to non-empty markup', () => {
    const html = renderToString(<App />);
    expect(html.trim().length).toBeGreaterThan(0);
  });
});
