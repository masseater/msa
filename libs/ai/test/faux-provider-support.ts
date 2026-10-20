import { Effect, Stream } from "effect";

import { stream } from "../src/compat.ts";
import type { AssistantMessageEvent } from "../src/types.ts";

function collectEvents(streamResult: ReturnType<typeof stream>): Promise<AssistantMessageEvent[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events: AssistantMessageEvent[] = [];
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
