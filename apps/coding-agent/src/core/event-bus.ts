import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type eventBusTypes from "./event-bus.types.ts";
import platform from "./platform/index.ts";
import EventEmitter from "./platform/node/events.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError } = platform;

function createEventBus(): eventBusTypes.EventBusController {
  const emitter = new EventEmitter();
  return {
    clear: () => {
      emitter.removeAllListeners();
    },
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
  };
}

const eventBus = {
  createEventBus,
};

export default eventBus;
