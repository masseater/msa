import type ControlledStorageClass from "./controlled-storage.ts";

declare namespace sessionSupportTypes {
  type Gate = {
    readonly entered: Promise<void>;
    release(): void;
  };

  type ControlledStorage = (typeof ControlledStorageClass)["prototype"];
}

export type { sessionSupportTypes as default };
