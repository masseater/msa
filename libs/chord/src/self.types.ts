import type SelfImplClass from "./self.ts";

declare namespace selfTypes {
  type SelfImpl = SelfImplClass;
}

export type { selfTypes as default };
