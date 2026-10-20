import type handleModule from "./handle.ts";

declare namespace handleTypes {
  type Handle = (typeof handleModule.Handle)["prototype"];
}

export type { handleTypes as default };
