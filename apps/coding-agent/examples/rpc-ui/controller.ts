import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { BLUE, BOLD, DIM, GREEN, MAGENTA, RED, RESET, YELLOW } from "./colors.ts";
import type { ExtensionUIRequest } from "./extension-ui-request.ts";
import { InputDialog } from "./input-dialog.ts";
import { LoadingIndicator } from "./loading-indicator.ts";
import { OutputLog } from "./output-log.ts";
import { PromptInput } from "./prompt-input.ts";
import { SelectDialog } from "./select-dialog.ts";
import { runSlashCommand } from "./slash-commands.ts";

const { Container } = tuiModule;

const NOTICE = `${MAGENTA}${BOLD}Notification:${RESET}`;

export class UiController {
  readonly outputLog = new OutputLog();
  readonly promptInput = new PromptInput();
  private readonly loadingIndicator = new LoadingIndicator();
  private readonly root = new Container();
  private activeDialog: tuiTypes.Component | null = null;
  private isStreaming = false;
  private hasTextOutput = false;

  private readonly tui: tuiTypes.TUI;
  private readonly send: (message: Record<string, unknown>) => void;
  private readonly exit: () => void;

  constructor(
    tui: tuiTypes.TUI,
    send: (message: Record<string, unknown>) => void,
    exit: () => void,
  ) {
    this.tui = tui;
    this.send = send;
    this.exit = exit;

    this.root.addChild(this.outputLog);
    this.root.addChild(this.promptInput);
    tui.addChild(this.root);
    tui.setFocus(this.promptInput.input);

    this.promptInput.input.onSubmit = (value) => this.submit(value);
    this.promptInput.onCtrlD = exit;
    this.promptInput.input.onEscape = () => this.onEscape();
  }

  notice(text: string): void {
    this.outputLog.append(`${NOTICE} ${text}`);
    this.tui.requestRender();
  }

  private onEscape(): void {
    if (this.isStreaming) {
      this.send({ type: "abort" });
      this.outputLog.append(`${YELLOW}[aborted]${RESET}`);
      this.tui.requestRender();
      return;
    }
    this.exit();
  }

  private setBottomComponent(component: tuiTypes.Component): void {
    this.root.clear();
    this.root.addChild(this.outputLog);
    if (this.isStreaming) this.root.addChild(this.loadingIndicator);
    this.root.addChild(component);
    this.tui.setFocus(component);
    this.tui.requestRender();
  }

  private showPrompt(): void {
    this.activeDialog = null;
    this.setBottomComponent(this.promptInput);
    this.tui.setFocus(this.promptInput.input);
  }

  private showDialog(dialog: tuiTypes.Component): void {
    this.activeDialog = dialog;
    this.setBottomComponent(dialog);
  }

  private showLoading(): void {
    if (this.isStreaming) return;

    this.isStreaming = true;
    this.hasTextOutput = false;
    this.root.clear();
    this.root.addChild(this.outputLog);
    this.root.addChild(this.loadingIndicator);
    this.root.addChild(this.activeDialog ?? this.promptInput);
    if (this.activeDialog === null) this.tui.setFocus(this.promptInput.input);
    this.loadingIndicator.start(this.tui);
    this.tui.requestRender();
  }

  private hideLoading(): void {
    this.loadingIndicator.stop();
    this.root.clear();
    this.root.addChild(this.outputLog);
    this.root.addChild(this.activeDialog ?? this.promptInput);
    if (this.activeDialog === null) this.tui.setFocus(this.promptInput.input);
    this.tui.requestRender();
  }

  selectDialog(
    title: string,
    options: string[],
    onDone: (value: string | undefined) => void,
  ): void {
    const dialog = new SelectDialog(title, options);
    dialog.onSelect = (value) => {
      this.showPrompt();
      onDone(value);
    };
    dialog.onCancel = () => {
      this.showPrompt();
      onDone(undefined);
    };
    this.showDialog(dialog);
  }

  inputDialog(
    title: string,
    prefill: string | undefined,
    onDone: (value: string | undefined) => void,
  ): void {
    const dialog = new InputDialog(title, prefill);
    dialog.onSubmit = (value) => {
      this.showPrompt();
      onDone(value.trim() || undefined);
    };
    dialog.onEscape = () => {
      this.showPrompt();
      onDone(undefined);
    };
    dialog.onCtrlD = this.exit;
    this.showDialog(dialog);
    this.tui.setFocus(dialog.inputComponent);
  }

  private respond(
    id: string,
    response:
      | { readonly value: string }
      | { readonly confirmed: boolean }
      | { readonly cancelled: true },
  ): void {
    this.send({ id, type: "extension_ui_response", ...response });
  }

  private respondValue(id: string, value: string | undefined): void {
    this.respond(id, value === undefined ? { cancelled: true } : { value });
  }

  private handleDialogRequest(req: ExtensionUIRequest): void {
    if (req.method === "select") {
      this.selectDialog(req.title ?? "Select", req.options ?? [], (value) =>
        this.respondValue(req.id, value),
      );
      return;
    }
    if (req.method === "confirm") {
      const title =
        req.message !== undefined && req.message.length > 0
          ? `${req.title}: ${req.message}`
          : (req.title ?? "Confirm");
      this.selectDialog(title, ["Yes", "No"], (value) =>
        this.respond(req.id, { confirmed: value === "Yes" }),
      );
      return;
    }
    if (req.method === "input" || req.method === "editor") {
      const title =
        req.placeholder !== undefined && req.placeholder.length > 0
          ? `${req.title} (${req.placeholder})`
          : (req.title ?? "Input");
      const dialogTitle = req.method === "editor" ? (req.title ?? "Editor") : title;
      this.inputDialog(dialogTitle, req.prefill?.replace(/\n/gu, " "), (value) =>
        this.respondValue(req.id, value),
      );
    }
  }

  private handleOutputRequest(req: ExtensionUIRequest): void {
    switch (req.method) {
      case "notify": {
        const notifyType = req.notifyType ?? "info";
        const color = notifyType === "error" ? RED : notifyType === "warning" ? YELLOW : MAGENTA;
        this.outputLog.append(`${color}${BOLD}Notification:${RESET} ${req.message}`);
        this.tui.requestRender();
        return;
      }
      case "setStatus":
        this.notice(`${DIM}[status: ${req.statusKey}]${RESET} ${req.statusText ?? "(cleared)"}`);
        return;
      case "setWidget": {
        const lines = req.widgetLines;
        if (lines === undefined || lines.length === 0) return;
        this.outputLog.append(`${NOTICE} ${DIM}[widget: ${req.widgetKey}]${RESET}`);
        for (const line of lines) {
          this.outputLog.append(`  ${DIM}${line}${RESET}`);
        }
        this.tui.requestRender();
        return;
      }
      case "set_editor_text":
        this.promptInput.input.setValue(req.text ?? "");
        this.tui.requestRender();
    }
  }

  handleExtensionUI(req: ExtensionUIRequest): void {
    this.handleDialogRequest(req);
    this.handleOutputRequest(req);
  }

  private appendTextDelta(delta: string): void {
    if (!this.hasTextOutput) {
      this.hasTextOutput = true;
      this.outputLog.append("");
      this.outputLog.append(`${BLUE}${BOLD}Agent:${RESET}`);
    }
    const parts = delta.split("\n");
    for (const [i, part] of parts.entries()) {
      if (i > 0) this.outputLog.append("");
      if (part.length > 0) this.outputLog.appendRaw(part);
    }
    this.tui.requestRender();
  }

  handleAgentEvent(data: Record<string, unknown>): void {
    const type = data["type"];

    if (type === "response" && data["success"] !== true) {
      this.outputLog.append(`${RED}[error]${RESET} ${data["command"]}: ${data["error"]}`);
      this.tui.requestRender();
      return;
    }
    if (type === "agent_start") {
      this.showLoading();
      return;
    }
    if (type === "extension_ui_request") {
      this.handleExtensionUI(data as unknown as ExtensionUIRequest);
      return;
    }
    if (type === "message_update") {
      const event = data["assistantMessageEvent"] as Record<string, unknown> | undefined;
      if (event?.["type"] === "text_delta") this.appendTextDelta(event["delta"] as string);
      return;
    }
    if (type === "tool_execution_start") {
      this.outputLog.append(`${DIM}[tool: ${data["toolName"]}]${RESET}`);
      this.tui.requestRender();
      return;
    }
    if (type === "tool_execution_end") {
      const result = JSON.stringify(data["result"]).slice(0, 120);
      this.outputLog.append(`${DIM}[result: ${result}...]${RESET}`);
      this.tui.requestRender();
      return;
    }
    if (type === "agent_settled") {
      this.isStreaming = false;
      this.hideLoading();
      this.outputLog.append("");
      this.tui.requestRender();
    }
  }

  private submit(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;

    this.promptInput.input.setValue("");
    this.outputLog.append(`${GREEN}${BOLD}You:${RESET} ${trimmed}`);

    if (!runSlashCommand({ command: trimmed, ui: this })) {
      this.send({ message: trimmed, type: "prompt" });
    }
    this.tui.requestRender();
  }
}
