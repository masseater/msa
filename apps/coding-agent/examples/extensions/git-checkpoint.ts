import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

export default function (msa: ExtensionAPI) {
  const checkpoints = new Map<string, string>();
  let currentEntryId: string | undefined;

  msa.on("tool_result", (_event, ctx) => {
    const leaf = ctx.sessionManager.getLeafEntry();
    if (leaf !== undefined) currentEntryId = leaf.id;
  });

  msa.on("turn_start", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout } = yield* Effect.promise(() => msa.exec("git", ["stash", "create"]));
        const ref = stdout.trim();
        if (ref.length > 0 && currentEntryId !== undefined && currentEntryId.length > 0) {
          checkpoints.set(currentEntryId, ref);
        }
      }),
    ),
  );

  msa.on("session_before_fork", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ref = checkpoints.get(event.entryId);
        if (ref === undefined || ref.length === 0) return;

        if (!ctx.hasUI) {
          return;
        }

        const choice = yield* Effect.promise(() =>
          ctx.ui.select("Restore code state?", [
            "Yes, restore code to that point",
            "No, keep current code",
          ]),
        );

        if (choice?.startsWith("Yes") === true) {
          yield* Effect.promise(() => msa.exec("git", ["stash", "apply", ref]));
          ctx.ui.notify("Code restored to checkpoint", "info");
        }
      }),
    ),
  );

  msa.on("agent_settled", () => {
    checkpoints.clear();
  });
}
