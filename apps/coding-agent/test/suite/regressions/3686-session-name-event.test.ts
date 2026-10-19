import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ExtensionAPI } from "../../../src/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const emitsSessionInfoChangedWhenAgentsession = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.session.setSessionName("hello world");

  expect(harness.sessionManager.getSessionName()).toBe("hello world");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "hello world",
  ]);
});

const emitsSessionInfoChangedWhenAn = Effect.gen(function* () {
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

  api?.setSessionName("from extension");

  expect(harness.sessionManager.getSessionName()).toBe("from extension");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "from extension",
  ]);
});

const emitsSessionInfoChangedToExtensions = Effect.gen(function* () {
  let api: ExtensionAPI | undefined;
  const events: Array<{ name: string | undefined }> = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          api = msa;
          msa.on("session_info_changed", (event) => {
            events.push({ name: event.name });
          });
        },
      ],
    }),
  );
  harnesses.push(harness);

  api?.setSessionName("first");
  harness.session.setSessionName("second");

  expect(events).toEqual([{ name: "first" }, { name: "second" }]);
});

describe("regression #3686: session name changes emit an event", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("emits session_info_changed when AgentSession.setSessionName is called", () =>
    Effect.runPromise(emitsSessionInfoChangedWhenAgentsession));
  it("emits session_info_changed when an extension calls msa.setSessionName", () =>
    Effect.runPromise(emitsSessionInfoChangedWhenAn));
  it("emits session_info_changed to extensions", () =>
    Effect.runPromise(emitsSessionInfoChangedToExtensions));
});
