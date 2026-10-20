import type { CompactionResult } from "../src/core/compaction/index.ts";
import type { SessionBeforeCompactEvent } from "../src/core/extensions/index.ts";

declare namespace compactionExtensionsSupportTypes {
  type Handler = (event: unknown, context: unknown) => Promise<unknown>;

  type BeforeCompactHandler = (
    event: SessionBeforeCompactEvent,
  ) => { cancel?: boolean; compaction?: Partial<CompactionResult> } | undefined;
}

export type { compactionExtensionsSupportTypes as default };
