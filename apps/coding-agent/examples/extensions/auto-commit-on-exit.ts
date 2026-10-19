import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

export default function (msa: ExtensionAPI) {
  msa.on("session_shutdown", (_event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout: status, code } = yield* Effect.promise(() =>
          msa.exec("git", ["status", "--porcelain"]),
        );

        if (code !== 0 || status.trim().length === 0) {
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        let lastAssistantText = "";
        for (const entry of entries.toReversed()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            const content = entry.message.content;
            if (Array.isArray(content)) {
              lastAssistantText = content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n");
            }
            break;
          }
        }

        const firstLine = lastAssistantText.split("\n")[0] || "Work in progress";
        const commitMessage = `[msa] ${firstLine.slice(0, 50)}${firstLine.length > 50 ? "..." : ""}`;

        yield* Effect.promise(() => msa.exec("git", ["add", "-A"]));
        const { code: commitCode } = yield* Effect.promise(() =>
          msa.exec("git", ["commit", "-m", commitMessage]),
        );

        if (commitCode === 0 && ctx.hasUI) {
          ctx.ui.notify(`Auto-committed: ${commitMessage}`, "info");
        }
      }),
    ),
  );
}
