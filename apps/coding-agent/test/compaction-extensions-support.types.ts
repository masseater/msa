import type compactionTypes from "../src/core/compaction/index.types.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";

declare namespace compactionExtensionsSupportTypes {
  type Handler = (event: unknown, context: unknown) => Promise<unknown>;

  type BeforeCompactHandler = (
    event: extensionsTypes.SessionBeforeCompactEvent,
  ) => { cancel?: boolean; compaction?: Partial<compactionTypes.CompactionResult> } | undefined;
}

export type { compactionExtensionsSupportTypes as default };
