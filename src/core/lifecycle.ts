/**
 * Readiness state and graceful shutdown.
 *
 * Liveness (the process is up) is deliberately separate from readiness (dependencies
 * are usable): a transient database or gateway blip must not make the platform cycle
 * the always-on instance. This module holds the live readiness flags and wires clean
 * shutdown so the DB pool and gateway connection close on SIGINT/SIGTERM.
 */
import { logger } from './logger.js';

interface ReadinessState {
  dbReachable: boolean;
  gatewayConnected: boolean;
}

const readiness: ReadinessState = {
  dbReachable: false,
  gatewayConnected: false,
};

export function setDbReachable(value: boolean): void {
  readiness.dbReachable = value;
}

export function setGatewayConnected(value: boolean): void {
  readiness.gatewayConnected = value;
}

export function getReadiness(): Readonly<ReadinessState> {
  return readiness;
}

type ShutdownTask = () => Promise<void> | void;
const shutdownTasks: ShutdownTask[] = [];

/** Register a cleanup task to run on graceful shutdown (e.g. close pool, destroy client). */
export function onShutdown(task: ShutdownTask): void {
  shutdownTasks.push(task);
}

let installed = false;

/** Install SIGINT/SIGTERM handlers that run registered cleanup tasks, then exit. */
export function installShutdownHandlers(): void {
  if (installed) return;
  installed = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'shutting down');
      void Promise.allSettled(shutdownTasks.map((task) => task())).then(() => process.exit(0));
    });
  }
}
