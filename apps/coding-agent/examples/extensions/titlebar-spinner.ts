/**
 * Titlebar Spinner Extension
 *
 * Shows a braille spinner animation in the terminal title while the agent is working.
 * Uses `ctx.ui.setTitle()` to update the terminal title via the extension API.
 *
 * Usage:
 *   msa --extension examples/extensions/titlebar-spinner.ts
 */

import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getBaseTitle(msa: ExtensionAPI): string {
  const cwd = path.basename(process.cwd());
  const session = msa.getSessionName();
  return session ? `msa - ${session} - ${cwd}` : `msa - ${cwd}`;
}

export default function (msa: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameIndex = 0;

  function stopAnimation(ctx: ExtensionContext) {
    if (timer) {
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
      const title = session ? `${frame} msa - ${session} - ${cwd}` : `${frame} msa - ${cwd}`;
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
