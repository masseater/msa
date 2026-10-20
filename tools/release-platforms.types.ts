import type releasePlatformsData from "./release-platforms-data.ts";

declare namespace releasePlatformsTypes {
  type ReleasePlatform = (typeof releasePlatformsData.RELEASE_PLATFORMS)[number];
}

export type { releasePlatformsTypes as default };
