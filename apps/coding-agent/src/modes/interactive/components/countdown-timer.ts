import type tuiTypes from "@msa/tui/index.types";

import type platformTypes from "../../../core/platform.types.ts";
import interval from "../../interval.ts";

const { every } = interval;

export default class CountdownTimer {
  private intervalId: platformTypes.Scheduled | undefined;
  private remainingSeconds: number;
  private tui: tuiTypes.TUI | undefined;
  private onTick: (seconds: number) => void;
  private onExpire: () => void;

  constructor(
    timeoutMs: number,
    tui: tuiTypes.TUI | undefined,
    onTick: (seconds: number) => void,
    onExpire: () => void,
  ) {
    this.tui = tui;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.remainingSeconds = Math.ceil(timeoutMs / 1000);
    this.onTick(this.remainingSeconds);

    this.intervalId = every(() => {
      this.remainingSeconds--;
      this.onTick(this.remainingSeconds);
      this.tui?.requestRender();

      if (this.remainingSeconds <= 0) {
        this.dispose();
        this.onExpire();
      }
    }, 1000);
  }

  dispose(): void {
    if (this.intervalId !== undefined) {
      this.intervalId.cancel();
      this.intervalId = undefined;
    }
  }
}
