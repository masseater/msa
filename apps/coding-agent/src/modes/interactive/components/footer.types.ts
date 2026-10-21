import type FooterComponentClass from "./footer.ts";

declare namespace footerTypes {
  type FooterComponent = (typeof FooterComponentClass)["prototype"];
}

export type { footerTypes as default };
