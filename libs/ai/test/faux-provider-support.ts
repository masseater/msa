import { Effect, Stream } from "effect";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { stream } = compat;

function collectEvents(
  streamResult: ReturnType<typeof stream>,
): Promise<typesModule.AssistantMessageEvent[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events: typesModule.AssistantMessageEvent[] = [];
      yield* Stream.fromAsyncIterable(streamResult, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      );
      return events;
    }),
  );
}

const registrations: Array<{ unregister: () => void }> = [];

const fauxProviderSupport = {
  collectEvents,
  registrations,
};

export default fauxProviderSupport;
