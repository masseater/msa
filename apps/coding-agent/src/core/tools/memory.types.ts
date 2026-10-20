import type { Static } from "typebox";

import type memory from "./memory.ts";

declare namespace memoryTypes {
  type MemoryToolInput = Static<typeof memory.memorySchema>;
}

export type { memoryTypes as default };
