import { version } from './version';

/**
 * Small fixed badge showing the build version. Visible in every environment except
 * production (where it returns null). All values are build-time constants, so it
 * renders identically on the server and during client hydration.
 */
export function VersionChip() {
  if (!version.display) return null;

  const label =
    version.commit && version.commit !== 'dev'
      ? `v${version.number} · ${version.commit.slice(0, 7)}`
      : `v${version.number}`;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        padding: '2px 8px',
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#fff',
        background: '#1f2937',
        borderRadius: 4,
        opacity: 0.85,
        zIndex: 9999,
      }}
      title={`Build: ${version.buildDate}`}
    >
      {label}
    </div>
  );
}
