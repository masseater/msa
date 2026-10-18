import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";

async function checkDirtyRepo(
  msa: ExtensionAPI,
  ctx: ExtensionContext,
  action: string,
): Promise<{ cancel: boolean } | undefined> {
  const { stdout, code } = await msa.exec("git", ["status", "--porcelain"]);

  if (code !== 0) {
    return;
  }

  const hasChanges = stdout.trim().length > 0;
  if (!hasChanges) {
    return;
  }

  if (!ctx.hasUI) {
    return { cancel: true };
  }

  const changedFiles = stdout.trim().split("\n").filter(Boolean).length;

  const choice = await ctx.ui.select(
    `You have ${changedFiles} uncommitted file(s). ${action} anyway?`,
    ["Yes, proceed anyway", "No, let me commit first"],
  );

  if (choice !== "Yes, proceed anyway") {
    ctx.ui.notify("Commit your changes first", "warning");
    return { cancel: true };
  }
  return undefined;
}

export default function (msa: ExtensionAPI) {
  msa.on("session_before_switch", (event, ctx) => {
    const action = event.reason === "new" ? "new session" : "switch session";
    return checkDirtyRepo(msa, ctx, action);
  });

  msa.on("session_before_fork", (_event, ctx) => checkDirtyRepo(msa, ctx, "fork"));
}
