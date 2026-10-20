import type tuiTypes from "@msa/tui/index.types";

import memoryViewHelpers from "./memory-view-helpers.ts";
import MemoryViewLayer2 from "./memory-view-layer-2.ts";
import type memoryViewTypes from "./memory-view.types.ts";

const { LIST_LIMIT } = memoryViewHelpers;

export default class MemoryView
  extends MemoryViewLayer2
  implements tuiTypes.Component, tuiTypes.Focusable
{
  constructor(options: memoryViewTypes.MemoryViewOptions) {
    super();
    this.options = options;
    this.records = options.service.list(LIST_LIMIT);
    for (const input of [this.searchInput, this.addInput]) {
      input.onSubmit = (value) => this.submit(value);
      input.onEscape = () => this.stopInput();
    }
  }
}
