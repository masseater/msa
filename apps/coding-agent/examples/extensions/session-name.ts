import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("session-name", {
    description: "Set or show session name (usage: /session-name [new name])",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (name.length > 0) {
        msa.setSessionName(name);
        ctx.ui.notify(`Session named: ${name}`, "info");
      } else {
        const current = msa.getSessionName();
        ctx.ui.notify(
          current !== undefined && current.length > 0
            ? `Session: ${current}`
            : "No session name set",
          "info",
        );
      }
    },
  });
}
