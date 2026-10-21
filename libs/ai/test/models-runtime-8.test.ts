import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/auth/types.ts";
import modelsModule from "../src/models.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { createModels } = modelsModule;

const { testProvider } = modelsRuntimeSupport;
const passesCallerSignalsToProviderAuth = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const received: AbortSignal[] = [];
      const apiKey: typesModule.ApiKeyAuth = {
        check: ({ signal }) => {
          received.push(signal);
          return Promise.resolve({ type: "api_key" });
        },
        login: (interaction) => {
          received.push(interaction.signal);
          return Promise.resolve({ key: "saved", type: "api_key" });
        },
        name: "Signal auth",
        resolve: ({ signal }) => {
          received.push(signal);
          return Promise.resolve({ auth: { apiKey: "resolved" } });
        },
      };
      const models = createModels();
      models.setProvider(testProvider({ auth: { apiKey }, id: "p1" }));

      yield* Effect.promise(() => models.checkAuth("p1", { signal: controller.signal }));
      yield* Effect.promise(() => models.getAuth("p1", { signal: controller.signal }));
      yield* Effect.promise(() =>
        models.login("p1", "api_key", {
          notify: () => {},
          prompt: () => Promise.resolve("unused"),
          signal: controller.signal,
        }),
      );

      expect(received).toEqual([controller.signal, controller.signal, controller.signal]);
    }),
  );
};

describe("Models runtime", () => {
  it("passes caller signals to provider auth callbacks", passesCallerSignalsToProviderAuth);
});
