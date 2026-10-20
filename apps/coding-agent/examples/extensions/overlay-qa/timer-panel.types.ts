import type TimerPanelClass from "./timer-panel.ts";

declare namespace timerPanelTypes {
  type TimerPanel = (typeof TimerPanelClass)["prototype"];
}

export type { timerPanelTypes as default };
