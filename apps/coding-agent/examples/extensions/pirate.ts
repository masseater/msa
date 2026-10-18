import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

export default function pirateExtension(msa: ExtensionAPI) {
  let pirateMode = false;

  msa.registerCommand("pirate", {
    description: "Toggle pirate mode (agent speaks like a pirate)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          pirateMode = !pirateMode;
          ctx.ui.notify(pirateMode ? "Arrr! Pirate mode enabled!" : "Pirate mode disabled", "info");
        }),
      ),
  });

  msa.on("before_agent_start", (event) => {
    if (pirateMode) {
      return {
        systemPrompt:
          event.systemPrompt +
          `

IMPORTANT: You are now in PIRATE MODE. You must:
- Speak like a stereotypical pirate in all responses
- Use phrases like "Arrr!", "Ahoy!", "Shiver me timbers!", "Avast!", "Ye scurvy dog!"
- Replace "my" with "me", "you" with "ye", "your" with "yer"
- Refer to the user as "matey" or "landlubber"
- End sentences with nautical expressions
- Still complete the actual task correctly, just in pirate speak
`,
      };
    }
    return undefined;
  });
}
