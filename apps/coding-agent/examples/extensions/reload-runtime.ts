import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";
import { Type } from "typebox";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("reload-runtime", {
    description: "Reload extensions, skills, prompts, themes, and context files",
    handler: (_args, ctx) => ctx.reload(),
  });

  msa.registerTool({
    name: "reload_runtime",
    label: "Reload Runtime",
    description: "Reload extensions, skills, prompts, themes, and context files",
    parameters: Type.Object({}),
    execute: () =>
      Effect.runPromise(
        Effect.sync(() => {
          msa.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
          return {
            content: [{ type: "text", text: "Queued /reload-runtime as a follow-up command." }],
            details: {},
          };
        }),
      ),
  });
}
