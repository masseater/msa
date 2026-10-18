import { uuidv7 } from "@msa/ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@msa/coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@msa/coding-agent";
import { Container, Markdown, matchesKey, Text } from "@msa/tui";
import { Clock, Effect } from "effect";

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type SessionEntry = {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

const extractTextParts = (content: unknown): string[] => {
  if (typeof content === "string") {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }

  return textParts;
};

const extractToolCallLines = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const toolCalls: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type !== "toolCall" || typeof block.name !== "string") {
      continue;
    }

    const args = block.arguments ?? {};
    toolCalls.push(`Tool ${block.name} was called with args ${JSON.stringify(args)}`);
  }

  return toolCalls;
};

const buildConversationText = (entries: SessionEntry[]): string => {
  const sections: string[] = [];

  for (const entry of entries) {
    if (
      entry.type !== "message" ||
      entry.message?.role === undefined ||
      entry.message?.role.length === 0
    ) {
      continue;
    }

    const role = entry.message.role;
    const isUser = role === "user";
    const isAssistant = role === "assistant";

    if (!isUser && !isAssistant) {
      continue;
    }

    const entryLines: string[] = [];
    const textParts = extractTextParts(entry.message.content);
    if (textParts.length > 0) {
      const roleLabel = isUser ? "User" : "Assistant";
      const messageText = textParts.join("\n").trim();
      if (messageText.length > 0) {
        entryLines.push(`${roleLabel}: ${messageText}`);
      }
    }

    if (isAssistant) {
      entryLines.push(...extractToolCallLines(entry.message.content));
    }

    if (entryLines.length > 0) {
      sections.push(entryLines.join("\n"));
    }
  }

  return sections.join("\n\n");
};

const buildSummaryPrompt = (conversationText: string): string =>
  [
    "Summarize this conversation so I can resume it later.",
    "Include goals, key decisions, progress, open questions, and next steps.",
    "Keep it concise and structured with headings.",
    "",
    "<conversation>",
    conversationText,
    "</conversation>",
  ].join("\n");

const showSummaryUi = (summary: string, ctx: ExtensionCommandContext) => {
  if (ctx.mode !== "tui") {
    return Promise.resolve();
  }

  return ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    const border = new DynamicBorder((s: string) => theme.fg("accent", s));
    const mdTheme = getMarkdownTheme();

    container.addChild(border);
    container.addChild(new Text(theme.fg("accent", theme.bold("Conversation Summary")), 1, 0));
    container.addChild(new Markdown(summary, 1, 1, mdTheme));
    container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
    container.addChild(border);

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
          done(undefined);
        }
      },
    };
  });
};

const summarizeConversation = (ctx: ExtensionCommandContext, conversationText: string) =>
  Effect.gen(function* () {
    const model = ctx.modelRegistry.find("openai", "gpt-5.2");
    if (model === undefined) {
      if (ctx.hasUI) ctx.ui.notify("Model openai/gpt-5.2 not found", "warning");
      return undefined;
    }
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
      if (ctx.hasUI) ctx.ui.notify("No authentication configured for openai/gpt-5.2", "warning");
      return undefined;
    }

    const summaryMessages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: buildSummaryPrompt(conversationText) }],
        timestamp: yield* Clock.currentTimeMillis,
      },
    ];

    const response = yield* Effect.promise(() =>
      ctx.modelRegistry.complete(
        model,
        { messages: summaryMessages },
        {
          reasoningEffort: "high",
          cacheRetention: "none",
          sessionId: uuidv7(),
        },
      ),
    );

    return response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  });

export default function (msa: ExtensionAPI) {
  msa.registerCommand("summarize", {
    description: "Summarize the current conversation in a custom UI",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const branch = ctx.sessionManager.getBranch();
          const conversationText = buildConversationText(branch);

          if (conversationText.trim().length === 0) {
            if (ctx.hasUI) {
              ctx.ui.notify("No conversation text found", "warning");
            }
            return;
          }

          if (ctx.hasUI) {
            ctx.ui.notify("Preparing summary...", "info");
          }

          const summary = yield* summarizeConversation(ctx, conversationText);
          if (summary === undefined) return;

          yield* Effect.promise(() => showSummaryUi(summary, ctx));
        }),
      ),
  });
}
