import type chordTypes from "../../src/index.types.ts";
import type counting from "./counting.ts";

declare namespace countingTypes {
  type StateFrame = Extract<chordTypes.Frame, { t: "state" }>;

  type CountingLink = (typeof counting.CountingLink)["prototype"];
}

export type { countingTypes as default };
