import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import memoryModule from "../../../core/memory/memory.ts";
import errors from "../../../utils/errors.ts";
import interop from "../../../utils/interop.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import type memoryViewTypes from "./memory-view.types.ts";
import scrollWindow from "./scroll-window.ts";

const { Input, getKeybindings, matchesKey, truncateToWidth, wrapTextWithAnsi } = tui;
const { SEPIACE_REQUESTS_URL } = memoryModule;
const { toErrorMessage } = errors;
const { callbackPromise } = interop;
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

  private signingIn: AbortController | undefined;

  private redirectWaiter: ((url: string | undefined) => void) | undefined;

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
    void options.service.client.connect().then(() => options.requestRender());
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.typing) {
      this.requestInput.handleInput(data);
    } else if (getKeybindings().matches(data, "tui.select.cancel")) {
      if (this.signingIn === undefined) this.options.onClose();
      else this.signingIn.abort();
    } else if (this.scrollStep(data) !== undefined) {
      this.scroll = Math.max(0, this.scroll + (this.scrollStep(data) ?? 0));
    } else if (
      getKeybindings().matches(data, "tui.select.confirm") &&
      (!this.busy || this.redirectWaiter !== undefined)
    ) {
      this.typing = true;
      this.requestInput.focused = this.focusedState;
    } else if (matchesKey(data, "r")) {
      this.options.setRecall(!this.options.service.settings.recall);
    } else if (matchesKey(data, "s") && !this.busy && !this.options.service.connected) {
      this.signIn();
    } else if (matchesKey(data, "o") && !this.busy) {
      this.signOut();
    }
    this.options.requestRender();
  }

  private finish(reply: { text: string; failed: boolean }): void {
    this.busy = false;
    this.signingIn = undefined;
    this.redirectWaiter = undefined;
    this.reply = reply;
    this.scroll = 0;
    this.options.requestRender();
  }

  private signIn(): void {
    const cancel = new AbortController();
    this.signingIn = cancel;
    this.busy = true;
    this.reply = { failed: false, text: "Contacting the sign-in server…" };
    void this.options.service
      .signIn(cancel.signal, {
        promptForRedirectUrl: (signal) =>
          callbackPromise<string | undefined>((resolve) => {
            this.redirectWaiter = resolve;
            signal.addEventListener("abort", () => resolve(undefined), { once: true });
          }),
        showAuthorizationUrl: (url) => {
          this.reply = {
            failed: false,
            text: `Sign in to sepiace in the browser:\n${url.href}\nIf the browser cannot reach this machine, press enter and paste the URL it was redirected to.`,
          };
          this.options.requestRender();
        },
      })
      .then(
        (note) => ({
          failed: false,
          text: note === undefined ? "Signed in to sepiace." : `Signed in to sepiace.\n${note}`,
        }),
        (error: unknown) => ({ failed: true, text: toErrorMessage(error) }),
      )
      .then((reply) => this.finish(reply));
  }

  private signOut(): void {
    this.busy = true;
    void this.options.service
      .signOut()
      .then(
        (removed) => ({
          failed: false,
          text: removed ? "Signed out of sepiace." : "No sepiace sign-in was stored.",
        }),
        (error: unknown) => ({ failed: true, text: toErrorMessage(error) }),
      )
      .then((reply) => this.finish(reply));
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
    if (this.redirectWaiter !== undefined) {
      this.redirectWaiter(request);
      this.redirectWaiter = undefined;
      return;
    }
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
    if (this.busy && this.signingIn === undefined) return ["", theme.fg("dim", " Sending…")];
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
      : this.signingIn === undefined
        ? [
            "",
            ` ${rawKeyHint("enter", "request")}  ${rawKeyHint("↑↓", "scroll")}  ${rawKeyHint("r", "recall on/off")}  ${this.options.service.connected ? rawKeyHint("o", "sign out") : rawKeyHint("s", "sign in")}  ${rawKeyHint("esc", "close")}`,
          ]
        : ["", ` ${rawKeyHint("enter", "paste the redirect URL")}  ${rawKeyHint("esc", "cancel")}`];
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
