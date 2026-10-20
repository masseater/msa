import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import keybindingHints from "../../modes/interactive/components/keybinding-hints.ts";
import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import interop from "../../utils/interop.ts";
import type clientTypes from "./client.types.ts";
import HuggingFaceSearch from "./huggingface-search.ts";
import type huggingfaceTypes from "./huggingface.types.ts";
import uiFrame from "./ui-frame.ts";
import type uiTypes from "./ui.types.ts";

const { frame, selectTheme } = uiFrame;
const { callbackPromise } = interop;
const { keyHint } = keybindingHints;
const { awaited, awaitingWith } = awaitingModule;
const { SelectList, Spacer, Text, truncateToWidth, visibleWidth } = tuiModule;

const DOWNLOAD_VALUE = "\0download";
function contextLabel(model: clientTypes.LlamaModelInfo): string | undefined {
  const context = model.meta?.n_ctx ?? model.meta?.n_ctx_train;
  if (context !== undefined && context !== 0)
    return context >= 1000 ? `${Math.round(context / 1000)}k` : String(context);
  const args = model.status.args ?? [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] !== "--ctx-size" && args[index] !== "-c" && args[index] !== "-ctx") continue;
    const value = Number(args[index + 1]);
    if (Number.isFinite(value) && value > 0)
      return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
  }
  return undefined;
}
function modelDescription(model: clientTypes.LlamaModelInfo): string {
  const details: string[] = [];
  const loaded = model.status.value === "loaded" || model.status.value === "sleeping";
  if (loaded) details.push("loaded");
  else if (model.status.value !== "unloaded") details.push(model.status.value);
  const context = loaded ? contextLabel(model) : undefined;
  if (context !== undefined && context !== "") details.push(`${context} context`);
  return details.join(" · ");
}
export default class LlamaView implements uiTypes.LlamaUi, tuiTypes.Focusable {
  private readonly tui: tuiTypes.TUI;
  private readonly theme: themeTypes.Theme;
  private readonly keybindings: keybindingsTypes.KeybindingsManager;
  private readonly searchCache = new Map<string, huggingfaceTypes.HuggingFaceModel[]>();
  private content: tuiTypes.Container;
  private inputHandler: { handleInput?(data: string): void } | undefined;
  private inputTarget: tuiTypes.Focusable | undefined;
  private progressPromise: Promise<void> | undefined;
  private progressResolver: (() => void) | undefined;
  private showingProgress = false;
  private isFocused = false;

  constructor(
    tui: tuiTypes.TUI,
    theme: themeTypes.Theme,
    keybindings: keybindingsTypes.KeybindingsManager,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.content = frame(theme, "llama.cpp models", [
      new Text(theme.fg("muted", "Loading…"), 1, 1),
    ]);
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    if (this.inputTarget !== undefined) this.inputTarget.focused = value;
  }

  private setContent(
    content: tuiTypes.Container,
    inputHandler?: { handleInput?(data: string): void },
    inputTarget?: tuiTypes.Focusable,
  ): void {
    if (this.inputTarget !== undefined) this.inputTarget.focused = false;
    this.progressPromise = undefined;
    this.progressResolver = undefined;
    this.showingProgress = false;
    this.content = content;
    this.inputHandler = inputHandler;
    this.inputTarget = inputTarget;
    if (this.inputTarget !== undefined) this.inputTarget.focused = this.isFocused;
    this.tui.requestRender();
  }

  showModels(
    serverUrl: string,
    models: clientTypes.LlamaModelInfo[],
  ): Promise<uiTypes.LlamaManagerAction> {
    const sorted = [...models].sort((left, right) => {
      const loaded =
        Number(right.status.value === "loaded") - Number(left.status.value === "loaded");
      return loaded || left.id.localeCompare(right.id);
    });
    const byId = new Map(sorted.map((model) => [model.id, model]));
    const items: tuiTypes.SelectItem[] = [
      ...sorted.map((model) => ({
        description: modelDescription(model),
        label: model.id,
        value: model.id,
      })),
      {
        description: "Hugging Face owner/repository[:quant]",
        label: "Download model…",
        value: DOWNLOAD_VALUE,
      },
    ];
    return callbackPromise((resolve) => {
      const list = new SelectList(items, Math.min(items.length, 12), selectTheme(this.theme), {
        maxPrimaryColumnWidth: 56,
        minPrimaryColumnWidth: 36,
      });
      list.onSelect = (item) => {
        if (item.value === DOWNLOAD_VALUE) resolve({ type: "download" });
        else {
          const model = byId.get(item.value);
          if (model !== undefined) resolve({ model, type: "model" });
        }
      };
      list.onCancel = () => resolve({ type: "close" });
      this.setContent(
        frame(
          this.theme,
          "llama.cpp models",
          [new Text(this.theme.fg("dim", serverUrl), 1, 0), new Spacer(1), list],
          `${keyHint("tui.select.confirm", "load/unload/download")} • ${keyHint("tui.select.cancel", "close")}`,
        ),
        list,
      );
    });
  }

  select(title: string, options: string[]): Promise<string | undefined> {
    return callbackPromise((resolve) => {
      const list = new SelectList(
        options.map((option) => ({ label: option, value: option })),
        Math.min(options.length, 12),
        selectTheme(this.theme),
      );
      list.onSelect = (item) => resolve(item.value);
      list.onCancel = () => resolve(undefined);
      this.setContent(
        frame(
          this.theme,
          title,
          [new Spacer(1), list],
          `${keyHint("tui.select.confirm", "select")} • ${keyHint("tui.select.cancel", "cancel")}`,
        ),
        list,
      );
    });
  }

  confirm(title: string, message: string): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return (yield* awaited(this.select(`${title}\n${message}`, ["Yes", "No"]))) === "Yes";
      }, this),
    );
  }

  connectionError(serverUrl: string, message: string): Promise<"retry" | "close"> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const choice = yield* awaited(
          this.select(`llama.cpp unavailable\n${serverUrl}\n\n${message}`, ["Retry", "Close"]),
        );
        return choice === "Retry" ? "retry" : "close";
      }, this),
    );
  }

  searchModels(
    search: (query: string, signal: AbortSignal) => Promise<huggingfaceTypes.HuggingFaceModel[]>,
  ): Promise<string | undefined> {
    return callbackPromise((resolve) => {
      const component = new HuggingFaceSearch(
        this.tui,
        this.theme,
        this.keybindings,
        search,
        this.searchCache,
        resolve,
      );
      this.setContent(
        frame(
          this.theme,
          "Download model",
          [new Spacer(1), component],
          `${keyHint("tui.select.confirm", "select")} • ${keyHint("tui.select.cancel", "back")}`,
        ),
        component,
        component,
      );
    });
  }

  showStatus(title: string, message: string): void {
    this.setContent(
      frame(this.theme, title, [new Spacer(1), new Text(this.theme.fg("muted", message), 1, 0)]),
    );
  }

  progress(state: uiTypes.ProgressState): Promise<void> {
    if (this.progressPromise === undefined) {
      this.progressPromise = callbackPromise((resolve) => {
        this.progressResolver = resolve;
      });
    }
    this.showingProgress = true;
    this.updateProgress(state);
    return this.progressPromise;
  }

  updateProgress(state: uiTypes.ProgressState): void {
    if (!this.showingProgress) return;
    const body = [
      new Text(this.theme.fg("text", state.model), 1, 0),
      new Spacer(1),
      new Text(this.theme.fg("muted", state.message), 1, 0),
    ];
    if (state.ratio !== undefined) {
      const available = 40;
      const filled = Math.round(Math.max(0, Math.min(1, state.ratio)) * available);
      body.push(
        new Text(
          this.theme.fg(
            "accent",
            `${"█".repeat(filled)}${"─".repeat(available - filled)} ${Math.round(state.ratio * 100)}%`,
          ),
          1,
          0,
        ),
      );
    }
    if (state.detail !== undefined && state.detail !== "")
      body.push(new Text(this.theme.fg("dim", state.detail), 1, 0));
    this.content = frame(this.theme, state.title, body, keyHint("tui.select.cancel", "stop"));
    this.inputHandler = undefined;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (
      this.progressResolver !== undefined &&
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      const resolve = this.progressResolver;
      this.progressPromise = undefined;
      this.progressResolver = undefined;
      resolve();
      return;
    }
    this.inputHandler?.handleInput?.(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.content
      .render(width)
      .map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
  }

  invalidate(): void {
    this.content.invalidate();
  }
}
