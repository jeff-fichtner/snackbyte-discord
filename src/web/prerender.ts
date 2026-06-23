import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';

/**
 * Build-time render entries. Each entry maps an output HTML file to the React
 * element rendered into it. A single-purpose app has one entry; a multi-page app
 * lists several. Pages whose content depends on the request are not prerendered —
 * they render at request time in server mode.
 *
 * Elements use createElement (not JSX) so this module loads under a plain Node/tsx
 * build step without a JSX transform.
 */
export interface PrerenderEntry {
  /** Output file name under the build output, e.g. "index.html". */
  html: string;
  /** The element to render to static markup. */
  element: ReactElement;
}

export const entries: PrerenderEntry[] = [{ html: 'index.html', element: createElement(App) }];

/** Renders an entry's element to a static HTML string. */
export function renderEntry(entry: PrerenderEntry): string {
  return renderToString(entry.element);
}
