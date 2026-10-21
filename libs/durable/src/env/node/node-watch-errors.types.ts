import type nodeWatchErrors from "./node-watch-errors.ts";

declare namespace nodeWatchErrorsTypes {
  type BudgetExceeded = (typeof nodeWatchErrors.BudgetExceeded)["prototype"];
}

export type { nodeWatchErrorsTypes as default };
