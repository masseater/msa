import { type TranscriptContext, fauxAssistantMessage, getCurrentTools } from "@msa/ai";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type { ExtensionFactory } from "../../../src/index.ts";
import type harnessTypes from "../harness.types.ts";

const compactViaHook: ExtensionFactory = (msa) => {
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

function captureRequest(harness: harnessTypes.Harness, text: string): () => TranscriptContext {
  let request: TranscriptContext | undefined;
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

function toolNames(context: TranscriptContext): string[] {
  return getCurrentTools(context.messages).map((tool) => tool.name);
}

function compactSession(harness: harnessTypes.Harness): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
      harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
      yield* Effect.promise(() => harness.session.prompt("first"));
      yield* Effect.promise(() => harness.session.prompt("second"));
      yield* Effect.promise(() => harness.session.compact());
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
