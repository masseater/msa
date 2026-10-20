import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createModels } from "../src/models.ts";
import { fauxAssistantMessage, fauxProvider } from "../src/providers/faux.ts";
import providersSupport from "./providers-support.ts";

const { context } = providersSupport;

const recordsCancellationAndReturnsDeferredFetch = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const faux = fauxProvider();
      const models = createModels();
      models.setProvider(faux.provider);
      faux.setResponses([
        () => Promise.reject(new Error("deferred failed")),
        fauxAssistantMessage("cancelled"),
      ]);
      const model = faux.getModel();

      const failedSubmission = yield* Effect.promise(() =>
        models.completeSimple(model, context, { deferred: true }),
      );
      const failedDeferred = failedSubmission.deferred;
      if (failedDeferred === undefined)
        throw new Error("Faux response did not include a deferred handle");
      const failed = yield* Effect.promise(() => models.fetchDeferred(model, failedDeferred));
      expect(failed).toMatchObject({ errorMessage: "deferred failed", stopReason: "error" });

      const cancelledSubmission = yield* Effect.promise(() =>
        models.completeSimple(model, context, { deferred: true }),
      );
      const cancelledDeferred = cancelledSubmission.deferred;
      if (cancelledDeferred === undefined)
        throw new Error("Faux response did not include a deferred handle");
      yield* Effect.promise(() => models.cancelDeferred(model, cancelledDeferred));
      expect(faux.state.cancelledDeferred).toEqual([cancelledDeferred]);
      const cancelled = yield* Effect.promise(() => models.fetchDeferred(model, cancelledDeferred));
      expect(cancelled).toMatchObject({
        errorMessage: expect.stringContaining("was cancelled"),
        stopReason: "error",
      });
    }),
  );

describe("fauxProvider", () => {
  it(
    "records cancellation and returns deferred fetch failures in-band",
    recordsCancellationAndReturnsDeferredFetch,
  );
});
