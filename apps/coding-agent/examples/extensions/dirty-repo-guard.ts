import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { Effect } from "effect";

const checkDirtyRepo = (msa: ExtensionAPI, ctx: ExtensionContext, action: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { stdout, code } = yield* Effect.promise(() =>
        msa.exec("git", ["status", "--porcelain"]),
      );

      if (code !== 0) {
        return undefined;
      }

      if (stdout.trim().length === 0) {
        return undefined;
      }

      if (!ctx.hasUI) {
        return { cancel: true };
      }

      const changedFiles = stdout.trim().split("\n").filter(Boolean).length;

      const choice = yield* Effect.promise(() =>
        ctx.ui.select(`You have ${changedFiles} uncommitted file(s). ${action} anyway?`, [
          "Yes, proceed anyway",
          "No, let me commit first",
        ]),
      );

      if (choice !== "Yes, proceed anyway") {
        ctx.ui.notify("Commit your changes first", "warning");
        return { cancel: true };
      }
      return undefined;
    }),
  );

export default function (msa: ExtensionAPI) {
  msa.on("session_before_switch", (event, ctx) => {
    const action = event.reason === "new" ? "new session" : "switch session";
    return checkDirtyRepo(msa, ctx, action);
  });

  msa.on("session_before_fork", (_event, ctx) => checkDirtyRepo(msa, ctx, "fork"));
}
