import type LoadingIndicatorClass from "./loading-indicator.ts";

declare namespace loadingIndicatorTypes {
  type LoadingIndicator = (typeof LoadingIndicatorClass)["prototype"];
}

export type { loadingIndicatorTypes as default };
