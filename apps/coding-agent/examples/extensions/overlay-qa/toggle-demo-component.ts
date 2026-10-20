import type { Theme } from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { BaseOverlay } from "./base-overlay.ts";
import { getGlobalToggleHandle } from "./global-toggle-handle.ts";

const { matchesKey } = tuiModule;

export class ToggleDemoComponent extends BaseOverlay {
  private tui: tuiTypes.TUI;
  private toggleCount = 0;
  private isToggling = false;
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }

    const handle = getGlobalToggleHandle();
    if (!matchesKey(data, "t") || handle === null || this.isToggling) return;

    this.isToggling = true;
    this.toggleCount++;
    handle.setHidden(true);

    Effect.runFork(
      Effect.sleep(1000).pipe(
        Effect.andThen(
          Effect.sync(() => {
            handle.setHidden(false);
            this.isToggling = false;
            this.tui.requestRender();
          }),
        ),
      ),
    );
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        th.fg("accent", " Toggle Demo"),
        "",
        " This overlay demonstrates the",
        " onHandle callback API.",
        "",
        ` Toggle count: ${th.fg("accent", String(this.toggleCount))}`,
        "",
        th.fg("dim", " Press 't' to hide for 1 second"),
        th.fg("dim", " (demonstrates setHidden API)"),
        "",
        th.fg("dim", " In real usage, a global keybinding"),
        th.fg("dim", " would toggle visibility externally."),
        "",
        th.fg("dim", " Press Esc to close"),
        "",
      ],
      width,
      "Toggle Demo",
    );
  }
}
