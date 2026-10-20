import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import utilities from "../../utilities.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;
const { assistantMsg, userMsg } = utilities;

const harnesses: harnessTypes.Harness[] = [];

const clearsBranchSummaryStateWhenSession = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_tree", () => ({ cancel: true }));
        },
      ],
    }),
  );
  harnesses.push(harness);

  const targetId = harness.sessionManager.appendMessage(userMsg("first"));
  harness.sessionManager.appendMessage(assistantMsg("reply"));
  const currentLeafId = harness.sessionManager.appendMessage(userMsg("second"));

  expect(harness.sessionManager.getLeafId()).toBe(currentLeafId);

  const result = yield* Effect.promise(() =>
    harness.session.navigateTree(targetId, { summarize: false }),
  );

  expect(result).toEqual({ cancelled: true });
  expect(harness.session.isCompacting).toBe(false);
  expect(harness.sessionManager.getLeafId()).toBe(currentLeafId);
});

const clearsBranchSummaryStateWhenSessionBefore = () =>
  Effect.runPromise(clearsBranchSummaryStateWhenSession);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #3688 tree cancellation compaction state", () => {
  afterEach(afterEachHook);
  it(
    "clears branch summary state when session_before_tree cancels navigation",
    clearsBranchSummaryStateWhenSessionBefore,
  );
});
