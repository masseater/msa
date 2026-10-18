import { Effect } from "effect";

import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive)/iu,
    /\bsudo\b/iu,
    /\b(chmod|chown)\b.*777/iu,
  ];

  msa.on("tool_call", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (event.toolName !== "bash") return undefined;

        const command = event.input.command as string;
        const isDangerous = dangerousPatterns.some((p) => p.test(command));

        if (isDangerous) {
          if (!ctx.hasUI) {
            return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
          }

          const choice = yield* Effect.promise(() =>
            ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]),
          );

          if (choice !== "Yes") {
            return { block: true, reason: "Blocked by user" };
          }
        }

        return undefined;
      }),
    ),
  );
}
