import type aiTypes from "@msa/ai/index.types";
import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { BorderedLoader } from "@msa/coding-agent";
import { Clock, Effect } from "effect";

const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering and format them for the user to fill in.

Output format:
- List each question on its own line, prefixed with "Q: "
- After each question, add a blank line for the answer prefixed with "A: "
- If no questions are found, output "No questions found in the last message."

Example output:
Q: What is your preferred database?
A: 

Q: Should we use TypeScript or JavaScript?
A: 

Keep questions in the order they appeared. Be concise.`;

type LastAssistantText = { ok: true; text: string } | { ok: false; reason: string };

const findLastAssistantText = (ctx: ExtensionContext): LastAssistantText => {
  for (const entry of ctx.sessionManager.getBranch().toReversed()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!("role" in msg) || msg.role !== "assistant") continue;
    if (msg.stopReason !== "stop") {
      return { ok: false, reason: `Last assistant message incomplete (${msg.stopReason})` };
    }
    const textParts = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    if (textParts.length > 0) {
      return { ok: true, text: textParts.join("\n") };
    }
  }
  return { ok: false, reason: "No assistant messages found" };
};

const extractQuestions = (ctx: ExtensionContext, lastAssistantText: string) =>
  ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, `Extracting questions using ${ctx.model!.id}...`);
    loader.onAbort = () => done(null);

    const doExtract = Effect.gen(function* () {
      const userMessage: aiTypes.UserMessage = {
        content: [{ type: "text", text: lastAssistantText }],
        role: "user",
        timestamp: yield* Clock.currentTimeMillis,
      };

      const response = yield* Effect.promise(() =>
        ctx.modelRegistry.complete(
          ctx.model!,
          { messages: [userMessage], systemPrompt: SYSTEM_PROMPT },
          { signal: loader.signal },
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

    Effect.runFork(
      doExtract.pipe(
        Effect.orElseSucceed(() => null),
        Effect.flatMap((text) => Effect.sync(() => done(text))),
      ),
    );

    return loader;
  });

export default function (msa: ExtensionAPI) {
  msa.registerCommand("qna", {
    description: "Extract questions from last assistant message into editor",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("qna requires interactive mode", "error");
            return;
          }

          if (ctx.model === undefined) {
            ctx.ui.notify("No model selected", "error");
            return;
          }

          const last = findLastAssistantText(ctx);
          if (!last.ok) {
            ctx.ui.notify(last.reason, "error");
            return;
          }

          const result = yield* Effect.promise(() => extractQuestions(ctx, last.text));

          if (result === null) {
            ctx.ui.notify("Cancelled", "info");
            return;
          }

          ctx.ui.setEditorText(result);
          ctx.ui.notify("Questions loaded. Edit and submit when ready.", "info");
        }),
      ),
  });
}
