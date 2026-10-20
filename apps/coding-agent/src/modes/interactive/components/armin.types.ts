import type ArminComponentClass from "./armin.ts";

declare namespace arminTypes {
  type ArminComponent = (typeof ArminComponentClass)["prototype"];
}

export type { arminTypes as default };
