import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type storeTypes from "../../../core/memory/store.types.ts";
import errors from "../../../utils/errors.ts";
import memoryViewHelpers from "./memory-view-helpers.ts";
import type memoryViewTypes from "./memory-view.types.ts";
import MemoryViewInput from "./memory-view/memory-view-input.ts";
import MemoryViewRendering from "./memory-view/memory-view-rendering.ts";
import scrollWindow from "./scroll-window.ts";

const { Input } = tui;
const { toErrorMessage } = errors;
const { LIST_LIMIT } = memoryViewHelpers;
const { fitView } = scrollWindow;

export default class MemoryView implements tuiTypes.Component, tuiTypes.Focusable {
  readonly rendering: MemoryViewRendering;
  readonly input: MemoryViewInput;

  readonly wantsViewportKeys = true;

  options!: memoryViewTypes.MemoryViewOptions;

  records!: storeTypes.MemoryRecord[];

  selectedId!: string | undefined;

  openId!: string | undefined;

  query!: string | undefined;

  busy = false;

  inputMode!: "search" | "add" | undefined;

  readonly searchInput = new Input({ placeholder: "Search memories", prompt: "› " });

  readonly addInput = new Input({ placeholder: "Memory to remember", prompt: "› " });

  scroll = 0;

  private generation = 0;

  room = 0;

  focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value && this.inputMode === "search";
    this.addInput.focused = value && this.inputMode === "add";
  }

  invalidate(): void {}

  rows(): storeTypes.MemoryRecord[] {
    return [
      ...this.records.filter((record) => record.scope === "project"),
      ...this.records.filter((record) => record.scope === "global"),
    ];
  }

  selected(rows: readonly storeTypes.MemoryRecord[]): storeTypes.MemoryRecord | undefined {
    return rows.find((record) => record.id === this.selectedId) ?? rows[0];
  }

  showRecords(records: storeTypes.MemoryRecord[]): void {
    this.generation += 1;
    this.records = records;
  }

  reload(): void {
    this.generation += 1;
    const generation = this.generation;
    this.options.service.list(LIST_LIMIT).then(
      (records) => {
        if (generation !== this.generation) return undefined;
        this.records = records;
        this.options.requestRender();
        return undefined;
      },
      (error: unknown) => {
        this.options.onError(toErrorMessage(error));
      },
    );
  }

  handleInput(data: string): void {
    this.input.handle(data);
  }

  render(width: number): string[] {
    const rows = this.rows();
    const open =
      this.openId !== undefined && this.openId !== ""
        ? rows.find((record) => record.id === this.openId)
        : undefined;
    const frame =
      open === undefined
        ? this.rendering.renderList(rows, width)
        : this.rendering.renderDetail(open, width);
    const max = Math.max(8, this.options.maxHeight());
    const room = Math.max(0, max - frame.header.length - frame.footer.length);
    this.room = Math.min(room, frame.body.length);
    const fitted = fitView(frame, width, max, this.scroll);
    this.scroll = fitted.offset;
    return fitted.lines;
  }

  constructor(options: memoryViewTypes.MemoryViewOptions) {
    this.rendering = new MemoryViewRendering(this);
    this.input = new MemoryViewInput(this);
    this.options = options;
    this.records = [];
    this.reload();
    for (const input of [this.searchInput, this.addInput]) {
      input.onSubmit = (value) => this.input.submit(value);
      input.onEscape = () => this.input.stopInput();
    }
  }
}
