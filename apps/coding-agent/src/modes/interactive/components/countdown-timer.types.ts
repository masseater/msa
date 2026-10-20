import type CountdownTimerClass from "./countdown-timer.ts";

declare namespace countdownTimerTypes {
  type CountdownTimer = (typeof CountdownTimerClass)["prototype"];
}

export type { countdownTimerTypes as default };
