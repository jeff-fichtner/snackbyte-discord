/**
 * Text-prefix parser — turns a prefixed message into a role/nickname capability call, independent of
 * discord.js. The messageCreate handler adapts a live message onto this; the same capabilities the
 * slash commands use run behind it, so text-prefix is a pure input adapter (Principle I).
 *
 * Supported (over the EXISTING 004 capabilities):
 *   <prefix>role <role name>   → toggle a self-assignable role by name
 *   <prefix>roles              → list self-assignable roles
 *   <prefix>nick [name]        → set (or, with no name, reset) own nickname
 *
 * Returns null for anything that is not one of these (non-prefixed, unknown command), so the handler
 * ignores it.
 */

export type TextCommand =
  | { kind: 'role'; roleName: string }
  | { kind: 'roles' }
  | { kind: 'nick'; nickname: string | undefined };

/**
 * Parse a message's content against `prefix`. Returns a structured command or null. The parser does
 * not resolve roles/members — it only classifies the command and extracts its raw argument.
 */
export function parseTextCommand(content: string, prefix: string): TextCommand | null {
  if (!prefix || !content.startsWith(prefix)) return null;
  const rest = content.slice(prefix.length).trim();
  if (rest.length === 0) return null;

  const [word, ...restParts] = rest.split(/\s+/);
  const arg = rest.slice(word.length).trim();

  switch (word.toLowerCase()) {
    case 'role':
      if (arg.length === 0) return null; // a role name is required
      return { kind: 'role', roleName: arg };
    case 'roles':
      return { kind: 'roles' };
    case 'nick':
      // No arg → reset (undefined); otherwise the provided nickname.
      return { kind: 'nick', nickname: restParts.length === 0 ? undefined : arg };
    default:
      return null;
  }
}
