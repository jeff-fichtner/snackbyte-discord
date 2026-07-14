/**
 * Component-role resolution — the pure logic deciding which role (if any) a component activation
 * should toggle, independent of discord.js. The component interaction handler adapts a live button /
 * select onto this and onto the existing role capability; it mirrors the 005 reaction resolver.
 *
 * A component toggles a role ONLY when an operator binding maps it to a role AND that role is on the
 * guild's self-assignable whitelist. The binding is additive configuration — the whitelist is the
 * authorization, so a component can never grant a role an operator has not whitelisted. Any miss
 * returns null (a no-op).
 */
import type { ComponentRoleBinding } from '../../db/repository.js';

export interface ComponentResolveInput {
  /** The guild's component→role bindings (read live per activation). */
  bindings: ComponentRoleBinding[];
  /** The guild's self-assignable-role whitelist (the authorization). */
  whitelistRoleIds: string[];
  /** The activated component's stable key: a button's customId, or a select's customId + value. */
  componentKey: string;
}

/**
 * Resolve a component activation to the role id it should toggle, or null to ignore it. Pure — no I/O.
 */
export function resolveComponentRole(input: ComponentResolveInput): string | null {
  const binding = input.bindings.find((b) => b.componentKey === input.componentKey);
  if (!binding) return null;
  if (!input.whitelistRoleIds.includes(binding.roleId)) return null;
  return binding.roleId;
}
