import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { Effect, type Fiber } from "effect";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const baseName = (path: string): string => path.split(/[\\/]/u).at(-1) ?? path;

function getBaseTitle(msa: ExtensionAPI): string {
  const cwd = baseName(process.cwd());
  const session = msa.getSessionName();
  return session !== undefined && session.length > 0 ? `msa - ${session} - ${cwd}` : `msa - ${cwd}`;
}

export default function (msa: ExtensionAPI) {
  let fiber: Fiber.Fiber<never> | undefined;
  let frameIndex = 0;

  function stopAnimation(ctx: ExtensionContext) {
    fiber?.interruptUnsafe();
    fiber = undefined;
    frameIndex = 0;
    ctx.ui.setTitle(getBaseTitle(msa));
  }

  function startAnimation(ctx: ExtensionContext) {
    stopAnimation(ctx);
    fiber = Effect.runFork(
      Effect.forever(
        Effect.sync(() => {
          const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
          const cwd = baseName(process.cwd());
          const session = msa.getSessionName();
          const title =
            session !== undefined && session.length > 0
              ? `${frame} msa - ${session} - ${cwd}`
              : `${frame} msa - ${cwd}`;
          ctx.ui.setTitle(title);
          frameIndex++;
        }).pipe(Effect.andThen(Effect.sleep(80))),
      ),
    );
  }

  msa.on("agent_start", (_event, ctx) => {
    startAnimation(ctx);
  });

  msa.on("agent_settled", (_event, ctx) => {
    stopAnimation(ctx);
  });

  msa.on("session_shutdown", (_event, ctx) => {
    stopAnimation(ctx);
  });
}
