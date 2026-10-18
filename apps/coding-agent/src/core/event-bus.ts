import { EventEmitter } from "node:events";

import * as Effect from "effect/Effect";

import { awaited, awaiting } from "./awaiting.ts";
import { writeError } from "./platform.ts";

export interface EventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface EventBusController extends EventBus {
  clear(): void;
}

export function createEventBus(): EventBusController {
  const emitter = new EventEmitter();
  return {
    emit: (channel, data) => {
      emitter.emit(channel, data);
    },
    on: (channel, handler) => {
      const safeHandler = (data: unknown) =>
        Effect.runPromise(
          awaiting(function* () {
            try {
              yield* awaited(handler(data));
            } catch (err) {
              writeError(`Event handler error (${channel}):`, err);
            }
          }),
        );
      emitter.on(channel, safeHandler);
      return () => emitter.off(channel, safeHandler);
    },
    clear: () => {
      emitter.removeAllListeners();
    },
  };
}
