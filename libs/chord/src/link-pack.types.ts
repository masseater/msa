import type linkPack from "./link-pack.ts";

declare namespace linkPackTypes {
  type Packed = (typeof linkPack.Packed)["prototype"];
}

export type { linkPackTypes as default };
