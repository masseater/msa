import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import fauxProviderSupport from "./faux-provider-support.ts";

const { complete, fauxAssistantMessage, registerFauxProvider } = compat;

const { registrations } = fauxProviderSupport;

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

const doesNotShareCacheAcrossSessions = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([
        fauxAssistantMessage("first"),
        fauxAssistantMessage("second"),
        fauxAssistantMessage("third"),
      ]);

      const context: typesModule.Context = {
        messages: [{ content: "hello", role: "user", timestamp: yield* Clock.currentTimeMillis }],
      };

      const first = yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "short",
          sessionId: "session-1",
        }),
      );
      expect(first.usage.cacheWrite).toBeGreaterThan(0);
      context.messages.push(first, {
        content: "follow up",
        role: "user",
        timestamp: (yield* Clock.currentTimeMillis) + 1,
      });

      const second = yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "short",
          sessionId: "session-2",
        }),
      );
      expect(second.usage.cacheRead).toBe(0);
      expect(second.usage.cacheWrite).toBeGreaterThan(0);

      const third = yield* Effect.promise(() => complete(registration.getModel(), context));
      expect(third.usage.cacheRead).toBe(0);
      expect(third.usage.cacheWrite).toBe(0);
    }),
  );

const simulatesPromptCachingPerSessionId = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

      const context: typesModule.Context = {
        messages: [{ content: "hello", role: "user", timestamp: yield* Clock.currentTimeMillis }],
        systemPrompt: "Be concise.",
      };

      const first = yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "short",
          sessionId: "session-1",
        }),
      );
      expect(first.usage.cacheRead).toBe(0);
      expect(first.usage.cacheWrite).toBeGreaterThan(0);

      context.messages.push(first, {
        content: "follow up",
        role: "user",
        timestamp: (yield* Clock.currentTimeMillis) + 1,
      });

      const second = yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "short",
          sessionId: "session-1",
        }),
      );
      expect(second.usage.cacheRead).toBeGreaterThan(0);
      expect(second.usage.input + second.usage.cacheRead).toBeGreaterThan(second.usage.input);
    }),
  );

const countsCachedCharactersUpToThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([
        fauxAssistantMessage("a"),
        fauxAssistantMessage("b"),
        fauxAssistantMessage("c"),
      ]);
      const options = { cacheRetention: "short", sessionId: "session-1" } as const;
      const user = (content: string) => ({ content, role: "user" as const, timestamp: 1 });

      yield* Effect.promise(() =>
        complete(registration.getModel(), { messages: [user("hello world")] }, options),
      );
      const extended = yield* Effect.promise(() =>
        complete(
          registration.getModel(),
          { messages: [user("hello world"), user("next")] },
          options,
        ),
      );
      expect(extended.usage).toMatchObject({ cacheRead: 4, cacheWrite: 3, input: 3 });

      const edited = yield* Effect.promise(() =>
        complete(
          registration.getModel(),
          { messages: [user("hello wide"), user("next")] },
          options,
        ),
      );
      expect(edited.usage).toMatchObject({ cacheRead: 3, cacheWrite: 4, input: 4 });
    }),
  );

const doesNotSimulateCachingWhenCacheRetention = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registration = registerFauxProvider();
      registrations.push(registration);
      registration.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);

      const context: typesModule.Context = {
        messages: [{ content: "hello", role: "user", timestamp: yield* Clock.currentTimeMillis }],
      };

      yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "none",
          sessionId: "session-1",
        }),
      );
      context.messages.push(fauxAssistantMessage("first"), {
        content: "follow up",
        role: "user",
        timestamp: (yield* Clock.currentTimeMillis) + 1,
      });
      const second = yield* Effect.promise(() =>
        complete(registration.getModel(), context, {
          cacheRetention: "none",
          sessionId: "session-1",
        }),
      );
      expect(second.usage.cacheRead).toBe(0);
      expect(second.usage.cacheWrite).toBe(0);
    }),
  );

describe("faux provider", () => {
  it(
    "does not share cache across sessions or requests without sessionId",
    doesNotShareCacheAcrossSessions,
  );
});

describe("faux provider", () => {
  it("simulates prompt caching per sessionId", simulatesPromptCachingPerSessionId);
});

describe("faux provider", () => {
  it(
    "counts cached characters up to the first difference in the joined prompt",
    countsCachedCharactersUpToThe,
  );
});

describe("faux provider", () => {
  it(
    "does not simulate caching when cacheRetention is none",
    doesNotSimulateCachingWhenCacheRetention,
  );
});
