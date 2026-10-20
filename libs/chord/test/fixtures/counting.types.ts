import type chordTypes from "../../src/index.types.ts";
import type CountingLinkClass from "./counting-link.ts";

declare namespace countingTypes {
  type StateFrame = Extract<chordTypes.Frame, { t: "state" }>;

  type CountingLink = (typeof CountingLinkClass)["prototype"];
}

export type { countingTypes as default };
