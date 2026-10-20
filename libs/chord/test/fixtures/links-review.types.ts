import type linksReview from "./links-review.ts";

declare namespace linksReviewTypes {
  type WatchedLink = (typeof linksReview.WatchedLink)["prototype"];
}

export type { linksReviewTypes as default };
