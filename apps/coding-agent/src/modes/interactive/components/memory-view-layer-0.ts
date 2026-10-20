import tui from "@msa/tui";

import type storeTypes from "../../../core/memory/store.types.ts";
import type memoryViewTypes from "./memory-view.types.ts";

const { Input } = tui;

export default abstract class MemoryViewLayer0 {
  readonly wantsViewportKeys = true;
  protected options!: memoryViewTypes.MemoryViewOptions;
  protected records!: storeTypes.MemoryRecord[];
  protected selectedId!: string | undefined;
  protected openId!: string | undefined;
  protected query!: string | undefined;
  protected busy = false;
  protected inputMode!: "search" | "add" | undefined;
  protected readonly searchInput = new Input({ placeholder: "Search memories", prompt: "› " });
  protected readonly addInput = new Input({ placeholder: "Memory to remember", prompt: "› " });
  protected scroll = 0;
  protected room = 0;
  protected focusedState = false;
}
