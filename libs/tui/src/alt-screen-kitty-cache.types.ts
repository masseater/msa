import type KittyImageCacheClass from "./alt-screen-kitty-cache.ts";

declare namespace altScreenKittyCacheTypes {
  interface PreparedKittyScreen {
    lines: string[];
    evictedImageDeletion: string;
  }

  type KittyImageCache = KittyImageCacheClass;
}

export type { altScreenKittyCacheTypes as default };
