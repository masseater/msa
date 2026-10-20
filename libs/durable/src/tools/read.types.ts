import type { Static } from "typebox";

import type imageTypes from "./image.types.ts";
import type readTextTypes from "./read-text.types.ts";
import type read from "./read.ts";

declare namespace readTypes {
  type ReadToolInput = Static<typeof read.readSchema>;

  type ReadToolOptions = {
    readonly images?: imageTypes.ImageProcessor;
  };

  type ReadToolDetails = readTextTypes.ReadToolDetails;
}

export type { readTypes as default };
