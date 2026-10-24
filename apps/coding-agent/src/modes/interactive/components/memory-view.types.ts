import type memoryTypes from "../../../core/memory/memory.types.ts";

declare namespace memoryViewTypes {
  interface MemoryViewOptions {
    service: memoryTypes.MemoryService;
    setRecall: (enabled: boolean) => void;
    onClose: () => void;
    requestRender: () => void;
    maxHeight: () => number;
  }
}

export type { memoryViewTypes as default };
