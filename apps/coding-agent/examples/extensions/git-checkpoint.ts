import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  const checkpoints = new Map<string, string>();
  let currentEntryId: string | undefined;

  msa.on("tool_result", (_event, ctx) => {
    const leaf = ctx.sessionManager.getLeafEntry();
    if (leaf !== undefined) currentEntryId = leaf.id;
  });

  msa.on("turn_start", async () => {
    const { stdout } = await msa.exec("git", ["stash", "create"]);
    const ref = stdout.trim();
    if (ref.length > 0 && currentEntryId !== undefined && currentEntryId.length > 0) {
      checkpoints.set(currentEntryId, ref);
    }
  });

  msa.on("session_before_fork", async (event, ctx) => {
    const ref = checkpoints.get(event.entryId);
    if (ref === undefined || ref.length === 0) return;

    if (!ctx.hasUI) {
      return;
    }

    const choice = await ctx.ui.select("Restore code state?", [
      "Yes, restore code to that point",
      "No, keep current code",
    ]);

    if (choice?.startsWith("Yes") === true) {
      await msa.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Code restored to checkpoint", "info");
    }
  });

  msa.on("agent_settled", () => {
    checkpoints.clear();
  });
}
