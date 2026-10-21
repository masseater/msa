import type { Static } from "typebox";

import type writeModule from "./write.ts";

declare namespace writeTypes {
  type WriteToolInput = Static<typeof writeModule.writeSchema>;
}

export type { writeTypes as default };
