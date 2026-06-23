import { VersionChip } from './VersionChip';

/** The app's root component. Replace this with your real UI. */
export function App() {
  return (
    <>
      <main
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          textAlign: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#e5e7eb',
          background: 'radial-gradient(120% 120% at 50% 0%, #1f2937 0%, #0b1120 60%)',
          padding: '2rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '3rem', fontWeight: 700, color: '#f9fafb' }}>
          Hello world!
        </h1>
        <p style={{ margin: 0, maxWidth: '32rem', lineHeight: 1.6, color: '#9ca3af' }}>
          This app is wired and ready to build. Edit{' '}
          <code
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.9em',
              color: '#a5b4fc',
              background: 'rgba(99,102,241,0.12)',
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
            }}
          >
            src/web/App.tsx
          </code>{' '}
          to begin.
        </p>
      </main>
      <VersionChip />
    </>
  );
}
