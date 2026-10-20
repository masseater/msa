import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type srcTypes from "../../../src/index.types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

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

  api?.setSessionName("from extension");

  expect(harness.sessionManager.getSessionName()).toBe("from extension");
  expect(harness.eventsOfType("session_info_changed").map((event) => event.name)).toEqual([
    "from extension",
  ]);
});

const emitsSessionInfoChangedToExtensions = Effect.gen(function* () {
  let api: srcTypes.ExtensionAPI | undefined;
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

const emitsSessionInfoChangedWhenAgentsessionSetsessionname = () =>
  Effect.runPromise(emitsSessionInfoChangedWhenAgentsession);

const emitsSessionInfoChangedWhenAnExtension = () =>
  Effect.runPromise(emitsSessionInfoChangedWhenAn);

const emitsSessionInfoChangedToExtensions2 = () =>
  Effect.runPromise(emitsSessionInfoChangedToExtensions);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regression #3686: session name changes emit an event", () => {
  afterEach(afterEachHook);
  it(
    "emits session_info_changed when AgentSession.setSessionName is called",
    emitsSessionInfoChangedWhenAgentsessionSetsessionname,
  );
  it(
    "emits session_info_changed when an extension calls msa.setSessionName",
    emitsSessionInfoChangedWhenAnExtension,
  );
  it("emits session_info_changed to extensions", emitsSessionInfoChangedToExtensions2);
});
