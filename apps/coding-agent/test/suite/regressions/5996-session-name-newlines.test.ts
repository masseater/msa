import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../../../src/index.types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const filtersNewlinesWhenAgentsessionSetsessionnameIs = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.context.transcript.setSessionName("hello\nworld\r\nagain");

  expect(harness.sessionManager.getSessionName()).toBe("hello world again");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "hello world again",
  ]);
});

const filtersNewlinesWhenAnExtensionCalls = Effect.gen(function* () {
  let api: srcTypes.ExtensionAPI | undefined;
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

const filtersNewlinesWhenAgentsessionSetsessionnameIsCalled = () =>
  Effect.runPromise(filtersNewlinesWhenAgentsessionSetsessionnameIs);

const filtersNewlinesWhenAnExtensionCallsMsa = () =>
  Effect.runPromise(filtersNewlinesWhenAnExtensionCalls);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regression #5996: session names do not contain newlines", () => {
  afterEach(afterEachHook);
  it(
    "filters newlines when AgentSession.setSessionName is called",
    filtersNewlinesWhenAgentsessionSetsessionnameIsCalled,
  );
  it(
    "filters newlines when an extension calls msa.setSessionName",
    filtersNewlinesWhenAnExtensionCallsMsa,
  );
});
