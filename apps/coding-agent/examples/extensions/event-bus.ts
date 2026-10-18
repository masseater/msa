import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  let currentCtx: ExtensionContext | undefined;

  msa.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
  });

  msa.events.on("my:notification", (data) => {
    const { message, from } = data as { message: string; from: string };
    currentCtx?.ui.notify(`Event from ${from}: ${message}`, "info");
  });

  msa.registerCommand("emit", {
    description: "Emit my:notification event (usage: /emit message)",
    handler: async (args, _ctx) => {
      const message = args.trim() || "hello";
      msa.events.emit("my:notification", { message, from: "/emit command" });
    },
  });

  msa.on("session_start", async () => {
    msa.events.emit("my:notification", {
      message: "Session started",
      from: "event-bus-example",
    });
  });
}
