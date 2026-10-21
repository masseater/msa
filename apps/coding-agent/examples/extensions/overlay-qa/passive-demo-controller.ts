import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, type Fiber } from "effect";

import BaseOverlay from "./base-overlay.ts";
import TimerPanel from "./timer-panel.ts";
import type timerPanelTypes from "./timer-panel.types.ts";
const { matchesKey } = tuiModule;

export default class PassiveDemoController extends BaseOverlay {
  focused = false;
  private tui: tuiTypes.TUI;
  private typed = "";
  private timerComponent: timerPanelTypes.TimerPanel;
  private timerHandle: tuiTypes.OverlayHandle | null = null;
  private fiber: Fiber.Fiber<never> | undefined;
  private inputCount = 0;
  private lastInputDebug = "";
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: codingAgentTypes.Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.timerComponent = new TimerPanel(theme);
    this.timerHandle = this.tui.showOverlay(this.timerComponent, {
      anchor: "top-right",
      margin: { right: 2, top: 1 },
      nonCapturing: true,
      width: 22,
    });
    const self = this;
    this.fiber = Effect.runFork(
      Effect.forever(
        Effect.gen(function* () {
          self.timerComponent.tick();
          self.tui.requestRender();
          yield* Effect.sleep(1000);
        }),
      ),
    );
  }

  handleInput(data: string): void {
    this.inputCount++;
    this.lastInputDebug = `len=${data.length} c0=${data.charCodeAt(0)}`;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done();
    } else if (matchesKey(data, "backspace")) {
      this.typed = this.typed.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.typed += data;
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const display = this.typed.length > 0 ? this.typed : th.fg("dim", "(type here)");
    return this.box(
      [
        "",
        ` ${th.fg("dim", `focused=${this.focused} inputs=${this.inputCount}`)}`,
        ` ${th.fg("dim", `last: ${this.lastInputDebug || "none"}`)}`,
        "",
        ` > ${display}`,
        "",
        th.fg("dim", " Type to prove input goes here."),
        th.fg("dim", " Press Esc to close both."),
        "",
      ],
      width,
      "Non-Capturing Demo",
    );
  }

  private cleanup(): void {
    this.fiber?.interruptUnsafe();
    this.fiber = undefined;
    this.timerHandle?.hide();
    this.timerHandle = null;
  }

  override dispose(): void {
    this.cleanup();
  }
}
