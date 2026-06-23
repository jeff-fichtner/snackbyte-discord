/**
 * Routing/dispatch engine. Given a canonical event: find every enabled route whose
 * source + exact event type match, then for each route (independently, so one failure
 * does not block another) — skip if already delivered, transform, resolve the target,
 * deliver through the single delivery service, and record the outcome.
 *
 * Routes are read live per event from the repository, so operator edits to the routing
 * table take effect on the next event with no restart.
 */
import { childLogger } from '../core/logger.js';
import { resolveTransform } from './transforms/registry.js';
import type { Repository } from '../db/repository.js';
import type { DeliveryService } from '../discord/delivery.js';
import type { CanonicalEvent } from '../sources/types.js';
import type { DispatchResult } from './types.js';

export interface EngineDeps {
  repo: Repository;
  delivery: DeliveryService;
}

const log = childLogger('engine');

export async function dispatch(event: CanonicalEvent, deps: EngineDeps): Promise<DispatchResult> {
  const routes = await deps.repo.findEnabledRoutes(event.source, event.eventType);
  const result: DispatchResult = {
    matched: routes.length,
    delivered: 0,
    skipped: 0,
    failed: 0,
  };

  await Promise.all(
    routes.map(async (route) => {
      const routeLog = log.child({
        route: route.id,
        source: event.source,
        eventType: event.eventType,
      });
      try {
        if (await deps.repo.alreadyDelivered(route.id, event.dedupeKey)) {
          result.skipped++;
          await deps.repo.recordDelivery({
            routeId: route.id,
            source: event.source,
            eventType: event.eventType,
            dedupeKey: event.dedupeKey,
            targetId: route.targetId,
            status: 'skipped',
          });
          return;
        }

        const target = await deps.repo.getTarget(route.targetId);
        if (!target) {
          result.failed++;
          await deps.repo.recordDelivery({
            routeId: route.id,
            source: event.source,
            eventType: event.eventType,
            dedupeKey: event.dedupeKey,
            targetId: route.targetId,
            status: 'failed',
            error: 'target missing or disabled',
          });
          return;
        }

        const transform = resolveTransform(route.transform);
        const message = transform(event, route.config);
        await deps.delivery.send(target, message);

        result.delivered++;
        await deps.repo.recordDelivery({
          routeId: route.id,
          source: event.source,
          eventType: event.eventType,
          dedupeKey: event.dedupeKey,
          targetId: route.targetId,
          status: 'ok',
        });
      } catch (err) {
        result.failed++;
        routeLog.error(
          { err: err instanceof Error ? err.message : String(err) },
          'route delivery failed',
        );
        await deps.repo
          .recordDelivery({
            routeId: route.id,
            source: event.source,
            eventType: event.eventType,
            dedupeKey: event.dedupeKey,
            targetId: route.targetId,
            status: 'failed',
            error: err instanceof Error ? err.message : 'delivery failed',
          })
          .catch(() => undefined);
      }
    }),
  );

  return result;
}
