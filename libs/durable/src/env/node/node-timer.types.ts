import type { Fiber } from "effect";

declare namespace nodeTimerTypes {
  type Timer = Fiber.Fiber<void>;
}

export type { nodeTimerTypes as default };
