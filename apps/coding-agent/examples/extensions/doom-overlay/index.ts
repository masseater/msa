import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import DoomOverlayComponent from "./doom-component.ts";
import DoomEngine from "./doom-engine.ts";
import type doomEngineTypes from "./doom-engine.types.ts";
import wadFinder from "./wad-finder.ts";
const { ensureWadFile } = wadFinder;

let activeEngine: doomEngineTypes.DoomEngine | null = null;
let activeWadPath: string | null = null;

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    margin: { top: 1 },
    maxHeight: "95%",
    width: "75%",
  },
} as const;

const startEngine = (wad: string) =>
  Effect.gen(function* () {
    if (activeEngine !== null && activeWadPath === wad) return true;
    activeEngine = new DoomEngine(wad);
    yield* Effect.tryPromise(() => activeEngine!.init());
    activeWadPath = wad;
    return false;
  });

const showOverlay = (
  ctx: codingAgentTypes.ExtensionCommandContext,
  isResume: boolean,
): Effect.Effect<void> =>
  Effect.promise(() =>
    ctx.ui.custom(
      (tui, _theme, _keybindings, done) =>
        new DoomOverlayComponent(tui, activeEngine!, () => done(undefined), isResume),
      OVERLAY_OPTIONS,
    ),
  );

const runDoom = (args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
  Effect.gen(function* () {
    ctx.ui.notify("Loading DOOM...", "info");
    const wad = args.trim().length > 0 ? args.trim() : yield* Effect.promise(ensureWadFile);

    if (wad === null || wad.length === 0) {
      ctx.ui.notify("Failed to download DOOM WAD file. Check your internet connection.", "error");
      return;
    }

    const isResume = yield* startEngine(wad);
    ctx.ui.notify(isResume ? "Resuming DOOM..." : `Loading DOOM from ${wad}...`, "info");
    yield* showOverlay(ctx, isResume);
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        ctx.ui.notify(`Failed to load DOOM: ${error}`, "error");
        activeEngine = null;
        activeWadPath = null;
      }),
    ),
  );

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerCommand("doom-overlay", {
    description: "Play DOOM as an overlay. Q to pause and exit.",

    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("DOOM requires interactive mode", "error");
            return;
          }

          yield* runDoom(args, ctx);
        }),
      ),
  });
}
