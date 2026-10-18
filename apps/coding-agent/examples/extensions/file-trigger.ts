

import * as fs from "node:fs";

import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  msa.on("session_start", async (_event, ctx) => {
    const triggerFile = "/tmp/agent-trigger.txt";

    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          msa.sendMessage(
            {
              customType: "file-trigger",
              content: `External trigger: ${content}`,
              display: true,
            },
            { triggerTurn: true }, 
          );
          fs.writeFileSync(triggerFile, ""); 
        }
      } catch {
        
      }
    });

    if (ctx.hasUI) {
      ctx.ui.notify(`Watching ${triggerFile}`, "info");
    }
  });
}
