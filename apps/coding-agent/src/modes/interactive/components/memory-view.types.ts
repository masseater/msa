import type memoryTypes from "../../../core/memory/memory.types.ts";
import type MemoryViewClass from "./memory-view.ts";

declare namespace memoryViewTypes {
  interface MemoryViewOptions {
    service: memoryTypes.MemoryService;
    onClose: () => void;

    confirm?: (message: string) => Promise<boolean>;
    onError: (message: string) => void;
    requestRender: () => void;

    maxHeight: () => number;
  }

  type MemoryView = (typeof MemoryViewClass)["prototype"];
}

export type { memoryViewTypes as default };
