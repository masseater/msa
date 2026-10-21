import type BaseOverlayClass from "./base-overlay.ts";

declare namespace baseOverlayTypes {
  type BaseOverlay = (typeof BaseOverlayClass)["prototype"];
}

export type { baseOverlayTypes as default };
