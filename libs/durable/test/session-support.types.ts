import type sessionSupport from "./session-support.ts";

declare namespace sessionSupportTypes {
  type Gate = {
    readonly entered: Promise<void>;
    release(): void;
  };

  type ControlledStorage = (typeof sessionSupport.ControlledStorage)["prototype"];
}

export type { sessionSupportTypes as default };
