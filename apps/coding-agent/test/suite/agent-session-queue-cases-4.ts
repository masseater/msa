import { fauxAssistantMessage } from "@msa/ai";
import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { harnesses } from "./agent-session-queue-cases-1.ts";
import { createHarness, getUserTexts } from "./harness.ts";

export const deliversFollowUpsQueuedDuringAgent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let sent = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa: ExtensionAPI) => {
          msa.on("agent_end", () =>
            runPromise(
              Effect.sync(() => {
                if (sent) return;
                sent = true;
                msa.sendUserMessage("conflict report", { deliverAs: "followUp" });
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("reply"), fauxAssistantMessage("follow-up reply")]);

  yield* Effect.promise(() => harness.session.prompt("hello"));
  yield* Effect.promise(() => harness.session.agent.waitForIdle());

  expect(getUserTexts(harness)).toEqual(["hello", "conflict report"]);
});
