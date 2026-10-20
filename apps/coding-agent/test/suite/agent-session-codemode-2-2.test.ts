import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { CustomEntry } from "../../src/core/session-manager.ts";
import { readCodemodeStore } from "../../src/extensions/codemode/execute.ts";
import {
  CODEMODE_STORE_ENTRY_TYPE,
  createCodemodeTool,
} from "../../src/extensions/codemode/tool.ts";
import agentSessionCodemode2Support from "./agent-session-codemode-2-support.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";

const { harnesses3, increment, setup3 } = agentSessionCodemode2Support;

const { resultText, runCodemode, trackCodemodeWorkers } = agentSessionCodemodeSupport;

const { nowIso } = testing;

trackCodemodeWorkers();

const runsWithoutASessionStartingFrom = Effect.gen(function* () {
  const tool = createCodemodeTool();
  const result = yield* Effect.promise(() => tool.execute("direct", { code: increment }));
  expect(result.content[1]).toEqual({ text: "1", type: "text" });
});

const loadsTheValuesWrittenOnThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => setup3());
  yield* Effect.promise(() => runCodemode(harness, increment));
  const firstPrompt = harness.sessionManager.getBranch().find((entry) => entry.type === "message");
  if (firstPrompt === undefined) throw new Error("No first prompt entry");
  expect(resultText(yield* Effect.promise(() => runCodemode(harness, increment)))).toBe("2");

  harness.sessionManager.branch(firstPrompt.id);
  expect(resultText(yield* Effect.promise(() => runCodemode(harness, increment)))).toBe("1");
});

const foldsStoreEntriesFromTheRoot = () => {
  let counter = 0;
  const entry = (data: unknown, customType = CODEMODE_STORE_ENTRY_TYPE): CustomEntry => ({
    customType,
    data,
    id: `entry-${++counter}`,
    parentId: null,
    timestamp: nowIso(),
    type: "custom",
  });
  expect(
    readCodemodeStore([
      entry({ delete: [], set: { a: 1, b: { c: 2 } } }),
      entry({ delete: ["b"], set: { a: 3 } }),
      entry({ set: { z: 1 } }),
      entry({ delete: [], set: { other: 1 } }, "other-extension"),
    ]),
  ).toEqual({ a: 3 });
};

const runsWithoutASessionStartingFromAn = () => Effect.runPromise(runsWithoutASessionStartingFrom);

const loadsTheValuesWrittenOnTheCurrent = () => Effect.runPromise(loadsTheValuesWrittenOnThe);

describe("codemode options and store", () => {
  afterEach(() => {
    while (harnesses3.length > 0) harnesses3.pop()?.cleanup();
  });

  it("runs without a session, starting from an empty store", runsWithoutASessionStartingFromAn);

  it("loads the values written on the current branch", loadsTheValuesWrittenOnTheCurrent);

  it("folds store entries from the root, ignoring malformed data", foldsStoreEntriesFromTheRoot);
});
