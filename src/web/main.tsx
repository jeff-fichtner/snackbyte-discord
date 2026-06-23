import { hydrateRoot, createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

// Hydrate prerendered markup when it's present (production prerender build); otherwise
// mount fresh — which covers dev (the prerender step hasn't run) and dynamic apps
// (which never prerender). Checking firstElementChild (a real element, not the comment
// placeholder) means this one entry point works for both prerendered and dynamic apps.
if (container.firstElementChild) {
  hydrateRoot(container, <App />);
} else {
  createRoot(container).render(<App />);
}
