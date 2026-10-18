import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(msa: ExtensionAPI): string {
  const cwd = path.basename(process.cwd());
  const session = msa.getSessionName();
  return session !== undefined && session.length > 0 ? `msa - ${session} - ${cwd}` : `msa - ${cwd}`;
}

export default function (msa: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;

  function stopAnimation(ctx: ExtensionContext) {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    frameIndex = 0;
    ctx.ui.setTitle(getBaseTitle(msa));
  }

  function startAnimation(ctx: ExtensionContext) {
    stopAnimation(ctx);
    timer = setInterval(() => {
      const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
      const cwd = path.basename(process.cwd());
      const session = msa.getSessionName();
      const title =
        session !== undefined && session.length > 0
          ? `${frame} msa - ${session} - ${cwd}`
          : `${frame} msa - ${cwd}`;
      ctx.ui.setTitle(title);
      frameIndex++;
    }, 80);
  }

  msa.on("agent_start", async (_event, ctx) => {
    startAnimation(ctx);
  });

  msa.on("agent_settled", async (_event, ctx) => {
    stopAnimation(ctx);
  });

  msa.on("session_shutdown", async (_event, ctx) => {
    stopAnimation(ctx);
  });
}
