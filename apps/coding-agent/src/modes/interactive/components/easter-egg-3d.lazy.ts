import { type TUI, TuiAltScreen } from "@msa/tui";

/**
 * Plays a 3D easter egg (see easter-egg-3d.ts), which loads on first use. Only fullscreen mode can show it, because
 * it dissolves the rendered screen. The screen is captured before loading. Returns false when it cannot play.
 */
function playEasterEgg3d(tui: TUI): boolean {
  if (!(tui instanceof TuiAltScreen)) return false;
  if (tui.hasOverlay()) return true;
  const screen = tui.getScreenLines();
  import("./easter-egg-3d.ts").then(
    (module) => module.playEasterEgg3d(tui, screen),
    () => {},
  );
  return true;
}

/** Plays the 3D Armin. Returns false when it cannot play, so the caller can fall back to the inline version. */
export function playArmin3d(tui: TUI): boolean {
  return playEasterEgg3d(tui);
}
