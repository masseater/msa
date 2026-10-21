import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

const TRIGGER = /\b(changes?|diff|modified)\b/iu;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("input", (event) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (event.streamingBehavior === "steer") {
          return { action: "continue" };
        }

        if (!TRIGGER.test(event.text)) {
          return { action: "continue" };
        }

        const { stdout, code } = yield* Effect.promise(() => msa.exec("git", ["diff", "--stat"]));
        if (code !== 0 || stdout.trim().length === 0) {
          return { action: "continue" };
        }

        return {
          action: "transform",
          text: `${event.text}\n\nCurrent uncommitted changes:\n\`\`\`\n${stdout.trim()}\n\`\`\``,
        };
      }),
    ),
  );
}
