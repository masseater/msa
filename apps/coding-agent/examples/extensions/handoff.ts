import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@msa/coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@msa/coding-agent";
import { Clock, DateTime, Effect } from "effect";

const { uuidv7 } = ai;

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Output only the new prompt, nothing else.`;

function entryToMessage(entry: SessionEntry): agentTypes.AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      timestamp: DateTime.makeUnsafe(entry.timestamp).epochMilliseconds,
      tokensBefore: entry.tokensBefore,
    };
  }
  return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): agentTypes.AgentMessage[] {
  const compactionIndex = branch.findLastIndex((entry) => entry.type === "compaction");
  const compaction = branch[compactionIndex];
  if (compaction === undefined) {
    return branch.map(entryToMessage).filter((message) => message !== undefined);
  }

  const firstKeptIndex =
    compaction.type === "compaction"
      ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
      : -1;
  const compactedBranch = [
    compaction,
    ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
    ...branch.slice(compactionIndex + 1),
  ];
  return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

const generatePrompt = (
  ctx: ExtensionContext,
  conversationText: string,
  goal: string,
  signal: AbortSignal,
) =>
  Effect.gen(function* () {
    const userMessage: aiTypes.Message = {
      content: [
        {
          type: "text",
          text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
        },
      ],
      role: "user",
      timestamp: yield* Clock.currentTimeMillis,
    };

    const response = yield* Effect.promise(() =>
      ctx.modelRegistry.complete(
        ctx.model!,
        { messages: [userMessage], systemPrompt: SYSTEM_PROMPT },
        {
          cacheRetention: "none",
          sessionId: uuidv7(),
          signal,
        },
      ),
    );

    if (response.stopReason === "aborted") {
      return null;
    }

    return response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  });

const generateHandoffPrompt = (
  ctx: ExtensionContext,
  conversationText: string,
  goal: string,
): Promise<string | null> =>
  ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, `Generating handoff prompt...`);
    loader.onAbort = () => done(null);

    Effect.runFork(
      generatePrompt(ctx, conversationText, goal, loader.signal).pipe(
        Effect.orElseSucceed(() => null),
        Effect.flatMap((text) => Effect.sync(() => done(text))),
      ),
    );

    return loader;
  });

const applyHandoff = (prompt: string, replacementCtx: ExtensionCommandContext): Promise<void> =>
  Effect.runPromise(
    Effect.sync(() => {
      replacementCtx.ui.setEditorText(prompt);
      replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
    }),
  );

const startHandoffSession = (
  ctx: ExtensionCommandContext,
  currentSessionFile: string | undefined,
  editedPrompt: string,
) =>
  ctx.newSession({
    ...(currentSessionFile === undefined ? {} : { parentSession: currentSessionFile }),
    withSession: (replacementCtx) => applyHandoff(editedPrompt, replacementCtx),
  });

const resolvePrompt = (
  ctx: ExtensionCommandContext,
  args: string,
  currentSessionFile: string | undefined,
) =>
  Effect.gen(function* () {
    const goal = args.trim();
    if (goal.length === 0) {
      ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
      return undefined;
    }

    const messages = getHandoffMessages(ctx.sessionManager.getBranch());
    if (messages.length === 0) {
      ctx.ui.notify("No conversation to hand off", "error");
      return undefined;
    }

    const conversationText = serializeConversation(convertToLlm(messages));
    const result = yield* Effect.promise(() => generateHandoffPrompt(ctx, conversationText, goal));
    if (result === null) {
      ctx.ui.notify("Cancelled", "info");
      return undefined;
    }

    const editedPrompt = yield* Effect.promise(() => ctx.ui.editor("Edit handoff prompt", result));
    if (editedPrompt === undefined) {
      ctx.ui.notify("Cancelled", "info");
      return undefined;
    }

    const newSessionResult = yield* Effect.promise(() =>
      startHandoffSession(ctx, currentSessionFile, editedPrompt),
    );
    if (newSessionResult.cancelled) {
      ctx.ui.notify("New session cancelled", "info");
    }
    return undefined;
  });

export default function (msa: ExtensionAPI) {
  msa.registerCommand("handoff", {
    description: "Transfer context to a new focused session",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("handoff requires interactive mode", "error");
            return;
          }

          if (ctx.model === undefined) {
            ctx.ui.notify("No model selected", "error");
            return;
          }

          yield* resolvePrompt(ctx, args, ctx.sessionManager.getSessionFile());
        }),
      ),
  });
}
