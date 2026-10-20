import type { Frame } from "../../src/index.ts";
import type counting from "./counting.ts";

declare namespace countingTypes {
  type StateFrame = Extract<Frame, { t: "state" }>;

  type CountingLink = (typeof counting.CountingLink)["prototype"];
}

export type { countingTypes as default };
