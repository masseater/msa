import ai from "@msa/ai";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Clock, Effect, Option } from "effect";

const { convertToLlm, serializeConversation } = codingAgent;

const { uuidv7 } = ai;

const buildSummaryMessages = (conversationText: string, previousSummary: string | undefined) => {
  const previousContext =
    previousSummary !== undefined && previousSummary.length > 0
      ? `\n\nPrevious session summary for context:\n${previousSummary}`
      : "";

  return [
    {
      content: [
        {
          text: `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:${previousContext}

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.

<conversation>
${conversationText}
</conversation>`,
          type: "text" as const,
        },
      ],
      role: "user" as const,
      timestamp: Effect.runSync(Clock.currentTimeMillis),
    },
  ];
};

const resolveModel = (ctx: codingAgentTypes.ExtensionContext) => {
  const model = ctx.modelRegistry.find("opencode", "gemini-3.5-flash");
  if (model === undefined) {
    ctx.ui.notify(`Could not find Gemini Flash model, using default compaction`, "warning");
  }
  return model;
};

const notifyStart = (
  ctx: codingAgentTypes.ExtensionContext,
  messageCount: number,
  tokensBefore: number,
  modelId: string,
): void => {
  ctx.ui.notify(
    `Custom compaction: summarizing ${messageCount} messages (${tokensBefore.toLocaleString()} tokens) with ${modelId}...`,
    "info",
  );
};

const completeSummary = (
  ctx: codingAgentTypes.ExtensionContext,
  model: Parameters<codingAgentTypes.ExtensionContext["modelRegistry"]["complete"]>[0],
  messages: ReturnType<typeof buildSummaryMessages>,
  signal: AbortSignal,
) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      ctx.modelRegistry.complete(
        model,
        { messages },
        {
          cacheRetention: "none",
          maxTokens: 8192,
          sessionId: uuidv7(),
          signal,
        },
      ),
    ).pipe(Effect.option);

    if (Option.isNone(response)) {
      ctx.ui.notify("Compaction failed, using default compaction", "error");
      return undefined;
    }

    const summary = response.value.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (summary.trim().length === 0) {
      if (!signal.aborted) {
        ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
      }
      return undefined;
    }

    return { summary, usage: response.value.usage };
  });

const summarize = (
  event: codingAgentTypes.SessionBeforeCompactEvent,
  ctx: codingAgentTypes.ExtensionContext,
) =>
  Effect.gen(function* () {
    ctx.ui.notify("Custom compaction extension triggered", "info");

    const { preparation, signal } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      tokensBefore,
      firstKeptEntryId,
      previousSummary,
    } = preparation;

    const model = resolveModel(ctx);
    if (model === undefined) return undefined;

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

    notifyStart(ctx, allMessages.length, tokensBefore, model.id);

    const conversationText = serializeConversation(convertToLlm(allMessages));
    const summaryMessages = buildSummaryMessages(conversationText, previousSummary);

    const completed = yield* completeSummary(ctx, model, summaryMessages, signal);
    if (completed === undefined) return undefined;

    return {
      compaction: {
        firstKeptEntryId,
        summary: completed.summary,
        tokensBefore,
        usage: completed.usage,
      },
    };
  });

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("session_before_compact", (event, ctx) => Effect.runPromise(summarize(event, ctx)));
}
