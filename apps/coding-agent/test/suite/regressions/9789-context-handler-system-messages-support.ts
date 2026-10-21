import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type srcTypes from "../../../src/index.types.ts";
import type harnessTypes from "../harness.types.ts";

const { fauxAssistantMessage, getCurrentTools } = ai;

const compactViaHook: srcTypes.ExtensionFactory = (msa) => {
  msa.on("session_before_compact", (event) =>
    Promise.resolve({
      compaction: {
        details: { source: "test" },
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        summary: "extension summary",
        tokensBefore: event.preparation.tokensBefore,
      },
    }),
  );
};

function captureRequest(
  harness: harnessTypes.Harness,
  text: string,
): () => aiTypes.TranscriptContext {
  let request: aiTypes.TranscriptContext | undefined;
  harness.setResponses([
    (context) => {
      request = context;
      return fauxAssistantMessage(text);
    },
  ]);
  return () => {
    if (request === undefined) throw new Error("expected a provider request");
    return request;
  };
}

function toolNames(context: aiTypes.TranscriptContext): string[] {
  return getCurrentTools(context.messages).map((tool) => tool.name);
}

function compactSession(harness: harnessTypes.Harness): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
      harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
      yield* Effect.promise(() => harness.session.run.prompting.prompt("first"));
      yield* Effect.promise(() => harness.session.run.prompting.prompt("second"));
      yield* Effect.promise(() => harness.session.compaction.manual.compact());
      expect(harness.session.messages.map((message) => message.role).slice(0, 2)).toEqual([
        "system",
        "compactionSummary",
      ]);
    }),
  );
}

const ContextHandlerSystemMessagesSupport = {
  captureRequest,
  compactSession,
  compactViaHook,
  toolNames,
};

export default ContextHandlerSystemMessagesSupport;
