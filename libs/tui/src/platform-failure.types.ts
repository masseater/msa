import type PlatformFailureClass from "./platform-failure.ts";

declare namespace platformFailureTypes {
  type PlatformFailure = PlatformFailureClass;
}

export type { platformFailureTypes as default };
