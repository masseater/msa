import { createAssistantMessageEventStream } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import utilities from "../../utilities.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;
const { assistantMsg, userMsg } = utilities;

const { currentTimeMillis } = testing;

const harnesses: harnessTypes.Harness[] = [];

const summarizesTreeBranchesWhenRequestAuth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);

  let streamCallCount = 0;
  harness.session.agent.streamFunction = (model, _context, options) => {
    streamCallCount++;
    expect(options?.apiKey).toBeUndefined();

    const stream = createAssistantMessageEventStream();
    stream.push({
      message: {
        api: model.api,
        content: [{ text: "branch summary text", type: "text" }],
        model: model.id,
        provider: model.provider,
        role: "assistant",
        stopReason: "stop",
        timestamp: currentTimeMillis(),
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0.25 },
          input: 1,
          output: 1,
          totalTokens: 2,
        },
      },
      reason: "stop",
      type: "done",
    });
    return stream;
  };

  const targetId = harness.sessionManager.appendMessage(userMsg("first branch"));
  harness.sessionManager.appendMessage(assistantMsg("first reply"));
  harness.sessionManager.appendMessage(userMsg("abandoned branch work"));
  harness.sessionManager.appendMessage(assistantMsg("abandoned reply"));

  const result = yield* Effect.promise(() =>
    harness.session.navigateTree(targetId, { summarize: true }),
  );

  expect(result.cancelled).toBe(false);
  expect(streamCallCount).toBe(1);
  expect(result.summaryEntry?.type).toBe("branch_summary");
  expect(result.summaryEntry?.summary).toContain("branch summary text");
  expect(result.summaryEntry?.usage?.cost.total).toBe(0.25);
});

const summarizesTreeBranchesWhenRequestAuthHas = () =>
  Effect.runPromise(summarizesTreeBranchesWhenRequestAuth);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #6324 branch summary ambient auth", () => {
  afterEach(afterEachHook);
  it(
    "summarizes tree branches when request auth has no API key",
    summarizesTreeBranchesWhenRequestAuthHas,
  );
});
