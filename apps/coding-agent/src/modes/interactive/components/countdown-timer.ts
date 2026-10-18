import type { TUI } from "@msa/tui";

import { type Scheduled } from "../../../core/platform.ts";
import { every } from "../../interval.ts";

export class CountdownTimer {
  private intervalId: Scheduled | undefined;
  private remainingSeconds: number;
  private tui: TUI | undefined;
  private onTick: (seconds: number) => void;
  private onExpire: () => void;

  constructor(
    timeoutMs: number,
    tui: TUI | undefined,
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
