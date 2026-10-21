import type BannerMessageComponentClass from "./tic-tac-toe-banner.ts";

declare namespace ticTacToeBannerTypes {
  type BannerMessageComponent = (typeof BannerMessageComponentClass)["prototype"];
}

export type { ticTacToeBannerTypes as default };
