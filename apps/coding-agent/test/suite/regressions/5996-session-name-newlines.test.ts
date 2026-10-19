import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionAPI } from "../../../src/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const filtersNewlinesWhenAgentsessionSetsessionnameIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.setSessionName("hello\nworld\r\nagain");

  expect(harness.sessionManager.getSessionName()).toBe("hello world again");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "hello world again",
  ]);
});

const filtersNewlinesWhenAnExtensionCalls = Effect.gen(function* () {
  let api: ExtensionAPI | undefined;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          api = msa;
        },
      ],
    }),
  );
  harnesses.push(harness);

  api?.setSessionName("from\nextension");

  expect(harness.sessionManager.getSessionName()).toBe("from extension");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "from extension",
  ]);
});

describe("regression #5996: session names do not contain newlines", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("filters newlines when AgentSession.setSessionName is called", () =>
    Effect.runPromise(filtersNewlinesWhenAgentsessionSetsessionnameIs));
  it("filters newlines when an extension calls msa.setSessionName", () =>
    Effect.runPromise(filtersNewlinesWhenAnExtensionCalls));
});
