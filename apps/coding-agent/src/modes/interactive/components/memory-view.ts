import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import memoryModule from "../../../core/memory/memory.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import type memoryViewTypes from "./memory-view.types.ts";
import scrollWindow from "./scroll-window.ts";

const { Input, getKeybindings, matchesKey, truncateToWidth, wrapTextWithAnsi } = tui;
const { SEPIACE_REQUESTS_URL } = memoryModule;
const { toErrorMessage } = errors;
const { theme } = themeModule;
const { rawKeyHint } = keybindingHints;
const { fitView } = scrollWindow;

export default class MemoryView implements tuiTypes.Component, tuiTypes.Focusable {
  readonly wantsViewportKeys = true;

  private readonly options: memoryViewTypes.MemoryViewOptions;

  readonly requestInput = new Input({
    placeholder: "Ask sepiace to remember, recall, or forget",
    prompt: "› ",
  });

  typing = false;

  busy = false;

  legacyPending = false;

  reply: { text: string; failed: boolean } | undefined;

  private scroll = 0;

  private room = 0;

  private focusedState = false;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.requestInput.focused = value && this.typing;
  }

  constructor(options: memoryViewTypes.MemoryViewOptions) {
    this.options = options;
    this.requestInput.onSubmit = (value) => this.submit(value);
    this.requestInput.onEscape = () => this.stopTyping();
    void options.service.legacyPending().then((pending) => {
      this.legacyPending = pending;
      options.requestRender();
      return undefined;
    });
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.typing) {
      this.requestInput.handleInput(data);
    } else if (getKeybindings().matches(data, "tui.select.cancel")) {
      this.options.onClose();
    } else if (this.scrollStep(data) !== undefined) {
      this.scroll = Math.max(0, this.scroll + (this.scrollStep(data) ?? 0));
    } else if (getKeybindings().matches(data, "tui.select.confirm") && !this.busy) {
      this.typing = true;
      this.requestInput.focused = this.focusedState;
    } else if (matchesKey(data, "r")) {
      this.options.setRecall(!this.options.service.settings.recall);
    }
    this.options.requestRender();
  }

  private scrollStep(data: string): number | undefined {
    const kb = getKeybindings();
    const page = Math.max(1, this.room - 1);
    if (kb.matches(data, "tui.select.up")) return -1;
    if (kb.matches(data, "tui.select.down")) return 1;
    if (kb.matches(data, "tui.select.pageUp")) return -page;
    if (kb.matches(data, "tui.select.pageDown")) return page;
    return undefined;
  }

  private stopTyping(): void {
    this.typing = false;
    this.requestInput.focused = false;
    this.options.requestRender();
  }

  private submit(value: string): void {
    const request = value.trim();
    this.stopTyping();
    if (request === "") return;
    this.requestInput.setValue("");
    this.busy = true;
    void this.options.service
      .send(request)
      .then(
        (text) => ({ failed: false, text: text === "" ? "sepiace returned nothing." : text }),
        (error: unknown) => ({ failed: true, text: toErrorMessage(error) }),
      )
      .then((reply) => {
        this.busy = false;
        this.reply = reply;
        this.scroll = 0;
        return this.options.requestRender();
      });
  }

  private statusLines(): string[] {
    const { service } = this.options;
    const state = service.connection;
    const connection =
      state.state === "ready"
        ? theme.fg("success", "connected")
        : theme.fg(
            state.state === "missing" ? "warning" : "error",
            `${state.state === "missing" ? "not connected" : "last request failed"} · ${state.detail}`,
          );
    return [
      ` sepiace  ${connection}`,
      ...(service.signInSaved
        ? []
        : [
            ` sign-in  ${theme.fg("warning", "not saved, lasts until msa exits · set credentialHelper in mcp.json")}`,
          ]),
      ` recall   ${service.settings.recall ? "on every prompt" : theme.fg("dim", "off")}`,
      ...(this.legacyPending ? [` memory.db ${theme.fg("warning", "waiting to move")}`] : []),
      ` ${theme.fg("dim", SEPIACE_REQUESTS_URL)}`,
    ];
  }

  private replyLines(width: number): string[] {
    if (this.busy) return ["", theme.fg("dim", " Sending…")];
    if (this.reply === undefined) return [];
    const color = this.reply.failed ? "error" : "text";
    return [
      "",
      ...wrapTextWithAnsi(this.reply.text, Math.max(10, width - 2)).map(
        (line) => ` ${theme.fg(color, line)}`,
      ),
    ];
  }

  render(width: number): string[] {
    const footer = this.typing
      ? [
          "",
          ...this.requestInput.render(width),
          ` ${rawKeyHint("enter", "send")}  ${rawKeyHint("esc", "cancel")}`,
        ]
      : [
          "",
          ` ${rawKeyHint("enter", "request")}  ${rawKeyHint("↑↓", "scroll")}  ${rawKeyHint("r", "recall on/off")}  ${rawKeyHint("esc", "close")}`,
        ];
    const frame = {
      body: [
        ...this.statusLines().map((line) => truncateToWidth(line, width)),
        ...this.replyLines(width),
      ],
      footer,
      header: [
        "",
        truncateToWidth(` ${theme.bold("Memory")}`, width),
        theme.fg("borderMuted", "─".repeat(width)),
      ],
    };
    const max = Math.max(8, this.options.maxHeight());
    this.room = Math.max(0, max - frame.header.length - frame.footer.length);
    const fitted = fitView(frame, width, max, this.scroll);
    this.scroll = fitted.offset;
    return fitted.lines;
  }
}
