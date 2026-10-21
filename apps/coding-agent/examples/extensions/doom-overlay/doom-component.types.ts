import type DoomOverlayComponentClass from "./doom-component.ts";

declare namespace doomComponentTypes {
  type DoomOverlayComponent = (typeof DoomOverlayComponentClass)["prototype"];
}

export type { doomComponentTypes as default };
