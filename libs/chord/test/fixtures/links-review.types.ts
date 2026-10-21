import type WatchedLinkClass from "./watched-link.ts";

declare namespace linksReviewTypes {
  type WatchedLink = (typeof WatchedLinkClass)["prototype"];
}

export type { linksReviewTypes as default };
