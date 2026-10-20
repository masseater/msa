import type RefImplClass from "./ref.ts";

declare namespace refTypes {
  type RefImpl = RefImplClass;
}

export type { refTypes as default };
