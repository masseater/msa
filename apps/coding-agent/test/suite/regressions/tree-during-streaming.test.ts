import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { userMsg } from "../../utilities.ts";
import { createHarness } from "../harness.ts";

const rejectsNavigationWithoutChangingTheActive = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  const targetId = harness.sessionManager.appendMessage(userMsg("first"));
  let navigationResult: unknown;
  let leafUnchanged = false;

  try {
    harness.setResponses([
      () =>
        runPromise(
          Effect.gen(function* () {
            const activeLeafId = harness.sessionManager.getLeafId();
            navigationResult = yield* Effect.promise(() =>
              harness.session.navigateTree(targetId, { summarize: false }).catch((error) => error),
            );
            leafUnchanged =
              activeLeafId !== targetId && harness.sessionManager.getLeafId() === activeLeafId;
            return fauxAssistantMessage("response");
          }),
        ),
    ]);
    yield* Effect.promise(() => harness.session.prompt("second"));

    expect(navigationResult).toEqual(
      new Error("Wait for the current response to finish before navigating the session tree."),
    );
    expect(leafUnchanged).toBe(true);
  } finally {
    harness.cleanup();
  }
});

describe("tree navigation during an active response", () => {
  it("rejects navigation without changing the active leaf", () =>
    Effect.runPromise(rejectsNavigationWithoutChangingTheActive));
});
