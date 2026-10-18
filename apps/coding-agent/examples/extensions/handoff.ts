import type { AgentMessage } from "@msa/agent-core";
import { type Message, uuidv7 } from "@msa/ai";
import type { ExtensionAPI, SessionEntry } from "@msa/coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@msa/coding-agent";
import { Effect } from "effect";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
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

export default function (msa: ExtensionAPI) {
  msa.registerCommand("handoff", {
    description: "Transfer context to a new focused session",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }

      if (ctx.model === undefined) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const goal = args.trim();
      if (goal.length === 0) {
        ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
        return;
      }

      const messages = getHandoffMessages(ctx.sessionManager.getBranch());

      if (messages.length === 0) {
        ctx.ui.notify("No conversation to hand off", "error");
        return;
      }

      const llmMessages = convertToLlm(messages);
      const conversationText = serializeConversation(llmMessages);
      const currentSessionFile = ctx.sessionManager.getSessionFile();

      const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, `Generating handoff prompt...`);
        loader.onAbort = () => done(null);

        const doGenerate = async () => {
          const userMessage: Message = {
            role: "user",
            content: [
              {
                type: "text",
                text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
              },
            ],
            timestamp: Date.now(),
          };

          const response = await ctx.modelRegistry.complete(
            ctx.model!,
            { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
            {
              signal: loader.signal,
              cacheRetention: "none",
              sessionId: uuidv7(),
            },
          );

          if (response.stopReason === "aborted") {
            return null;
          }

          return response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        };

        Effect.runFork(
          Effect.tryPromise(doGenerate).pipe(
            Effect.catch((error) =>
              Effect.as(Effect.logError("Handoff generation failed:", error.cause), null),
            ),
            Effect.flatMap((text) => Effect.sync(() => done(text))),
          ),
        );

        return loader;
      });

      if (result === null) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);

      if (editedPrompt === undefined) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const newSessionResult = await ctx.newSession({
        ...(currentSessionFile === undefined ? {} : { parentSession: currentSessionFile }),
        withSession: async (replacementCtx) => {
          replacementCtx.ui.setEditorText(editedPrompt);
          replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
        },
      });

      if (newSessionResult.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
      }
    },
  });
}
