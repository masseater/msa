import { Clock, Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { complete, fauxAssistantMessage, registerFauxProvider, stream } from "../src/compat.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import fauxProviderSupport from "./faux-provider-support.ts";

const { registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const slowToolCallProvider = () => {
  const registration = registerFauxProvider({
    tokenSize: { max: 3, min: 3 },
    tokensPerSecond: 100,
  });
  registrations.push(registration);
  registration.setResponses([
    {
      ...fauxAssistantMessage("done"),
      content: [
        {
          arguments: { count: 123456789, text: "abcdefghijklmnopqrstuvwxyz" },
          id: "tool-1",
          name: "echo",
          type: "toolCall",
        },
      ],
      stopReason: "toolUse",
    },
  ]);
  return registration;
};

const supportsAbortingMidToolcallStreamWhen = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const s = stream(
        slowToolCallProvider().getModel(),
        { messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }] },
        { signal: controller.signal },
      );
      const events: string[] = [];
      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event.type);
            if (event.type === "toolcall_delta") controller.abort();
          }),
        ),
      );

      expect(events.filter((type) => type === "toolcall_delta")).toHaveLength(1);
      expect(events).toContain("toolcall_start");
      expect(events).toContain("error");
      expect(events).not.toContain("toolcall_end");
    }),
  );
};

const unregistersTheProvider = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registration.setResponses([fauxAssistantMessage("hello")]);
      registration.unregister();

      const timestamp = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        expect(
          complete(registration.getModel(), {
            messages: [{ content: "hi", role: "user", timestamp }],
          }),
        ).rejects.toThrow(`No API provider registered for api: ${registration.api}`),
      );
    }),
  );

describe("faux provider", () => {
  it("supports aborting mid-toolcall stream when paced", supportsAbortingMidToolcallStreamWhen);
});

describe("faux provider", () => {
  it("unregisters the provider", unregistersTheProvider);
});
