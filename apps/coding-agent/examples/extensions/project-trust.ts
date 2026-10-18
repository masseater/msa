import { Effect } from "effect";

import type { ExtensionAPI, ProjectTrustContext } from "@msa/coding-agent";

const TRUST_CHOICES = [
  "Trust and remember",
  "Trust with note and remember",
  "Trust this session",
  "Do not trust this session",
  "Let built-in prompt decide",
] as const;

const decideTrust = (ctx: ProjectTrustContext, choice: string | undefined) =>
  Effect.gen(function* () {
    if (choice === "Trust with note and remember") {
      const note = yield* Effect.promise(() =>
        ctx.ui.input("Project trust note", "Optional note for this demo"),
      );
      ctx.ui.notify(
        note === undefined || note.length === 0
          ? "No demo note entered"
          : `Recorded demo note: ${note}`,
        "info",
      );
      return { trusted: "yes", remember: true } as const;
    }
    if (choice === "Trust and remember") {
      return { trusted: "yes", remember: true } as const;
    }
    if (choice === "Trust this session") {
      return { trusted: "yes" } as const;
    }
    if (choice === "Do not trust this session") {
      return { trusted: "no" } as const;
    }
    return { trusted: "undecided" } as const;
  });

export default function (msa: ExtensionAPI) {
  let loadCount = 0;
  loadCount++;

  msa.on("project_trust", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        ctx.ui.notify(
          `project_trust fired for ${event.cwd} (mode: ${ctx.mode}, load: ${loadCount})`,
          "info",
        );

        if (!ctx.hasUI) {
          return { trusted: "undecided" };
        }

        const choice = yield* Effect.promise(() =>
          ctx.ui.select(`Project trust for:\n${event.cwd}`, [...TRUST_CHOICES]),
        );
        return yield* decideTrust(ctx, choice);
      }),
    ),
  );

  msa.on("session_start", (_event, ctx) => {
    ctx.ui.notify(`project-trust example loaded after trust resolution in ${ctx.cwd}`, "info");
  });
}
