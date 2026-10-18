import { type TUI, TuiAltScreen } from "@msa/tui";

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

export function playArmin3d(tui: TUI): boolean {
  return playEasterEgg3d(tui);
}
