import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createModels } from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { context, testModel, testProvider } = modelsRuntimeSupport;
const producesAnErrorStreamForUnknown = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels();
      const result = yield* Effect.promise(() =>
        models.completeSimple(testModel("ghost", "model-a"), context),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("Unknown provider: ghost");
    }),
  );

const streamsThroughTheProvider = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const models = createModels();
      models.setProvider(testProvider({ id: "p1" }));
      const model = testModel("p1", "model-a");

      const events: string[] = [];
      const stream = models.streamSimple(model, context);
      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
          }),
        ),
      );
      expect(events).toEqual(["start", "done"]);
      const message = yield* Effect.promise(() => stream.result());
      expect(message.stopReason).toBe("stop");
    }),
  );

describe("Models runtime", () => {
  it(
    "produces an error stream for unknown providers instead of throwing",
    producesAnErrorStreamForUnknown,
  );

  it("streams through the provider", streamsThroughTheProvider);
});
