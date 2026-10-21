import tui from "@msa/tui";

import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";

const { theme } = themeModule;
const { keyHint } = keybindingHints;
const { Input, truncateToWidth } = tui;

type StateField = "currentState" | "goalState";

type Composing =
  | { kind: "message"; taskId: string }
  | { kind: "note"; round: string }
  | { kind: "depends"; taskId: string }
  | { kind: "state"; taskId: string; field: StateField };

interface ComposerHost {
  orchestrator: orchestratorTypes.Orchestrator;
  onError: (message: string) => void;
  requestRender: () => void;
}

function composerLabel(composing: Composing): string {
  switch (composing.kind) {
    case "message":
      return "Message to this task";
    case "note":
      return `Shared note to round ${composing.round}`;
    case "depends":
      return `Dependencies of ${composing.taskId}  +id  -id`;
    case "state":
      return `${composing.field === "currentState" ? "Current state" : "Goal state"} of ${composing.taskId}`;
  }
}

function parseDepends(text: string): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const token of text.split(/[\s,]+/u).filter(Boolean)) {
    const id = token.replace(/^[+-]/u, "");
    if (id === "") continue;
    if (token.startsWith("-")) remove.push(id);
    else add.push(id);
  }
  return { add, remove };
}

export default class TaskComposer {
  private readonly input = new Input({ prompt: "› " });
  private readonly host: ComposerHost;
  private composing: Composing | undefined;
  private hostFocused = false;

  constructor(host: ComposerHost) {
    this.host = host;
    this.input.onSubmit = (value) => this.submit(value);
    this.input.onEscape = () => this.stop();
  }

  get active(): boolean {
    return this.composing !== undefined;
  }

  setFocused(focused: boolean): void {
    this.hostFocused = focused;
    this.input.focused = focused && this.active;
  }

  start(composing: Composing, initial = ""): void {
    this.composing = composing;
    this.input.setValue(initial);
    this.input.focused = this.hostFocused;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
    this.host.requestRender();
  }

  render(width: number): string[] {
    const composing = this.composing;
    if (composing === undefined) return [];
    const action = composing.kind === "message" || composing.kind === "note" ? "send" : "set";
    return [
      truncateToWidth(` ${theme.fg("accent", composerLabel(composing))}`, width),
      ...this.input.render(width),
      ` ${keyHint("tui.input.submit", action)}  ${keyHint("tui.select.cancel", "cancel")}`,
    ];
  }

  private stop(): void {
    this.composing = undefined;
    this.input.focused = false;
    this.host.requestRender();
  }

  private submit(value: string): void {
    const composing = this.composing;
    const text = value.trim();
    this.stop();
    if (composing === undefined || text === "") return;
    this.send(composing, text).catch((error: unknown) => {
      this.host.onError(errors.toErrorMessage(error));
    });
  }

  private send(composing: Composing, text: string): Promise<unknown> {
    const { orchestrator } = this.host;
    switch (composing.kind) {
      case "note":
        return orchestrator.sendNote({ audience: "round", content: text, round: composing.round });
      case "depends":
        return orchestrator.setDepends({ taskIds: [composing.taskId], ...parseDepends(text) });
      case "state":
        return orchestrator.setState({ taskId: composing.taskId, [composing.field]: text });
      case "message":
        return orchestrator.sendMessage(composing.taskId, text);
    }
  }
}
