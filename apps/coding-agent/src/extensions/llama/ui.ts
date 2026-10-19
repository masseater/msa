import {
  Container,
  type Focusable,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@msa/tui";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited, awaiting, awaitingWith } from "../../core/awaiting.ts";
import type { ExtensionCommandContext } from "../../core/extensions/types.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { callbackPromise } from "../../utils/interop.ts";
import type { LlamaModelInfo, LlamaProgress } from "./client.ts";
import { HuggingFaceSearch } from "./huggingface-search.ts";
import type { HuggingFaceModel } from "./huggingface.ts";
import { frame, selectTheme } from "./ui-frame.ts";

const DOWNLOAD_VALUE = "\0download";

export type LlamaManagerAction =
  | { type: "model"; model: LlamaModelInfo }
  | { type: "download" }
  | { type: "close" };

interface ProgressState extends LlamaProgress {
  title: string;
  model: string;
}

function contextLabel(model: LlamaModelInfo): string | undefined {
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

function modelDescription(model: LlamaModelInfo): string {
  const details: string[] = [];
  const loaded = model.status.value === "loaded" || model.status.value === "sleeping";
  if (loaded) details.push("loaded");
  else if (model.status.value !== "unloaded") details.push(model.status.value);
  const context = loaded ? contextLabel(model) : undefined;
  if (context !== undefined && context !== "") details.push(`${context} context`);
  return details.join(" · ");
}

export interface LlamaUi {
  showModels(serverUrl: string, models: LlamaModelInfo[]): Promise<LlamaManagerAction>;
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  connectionError(serverUrl: string, message: string): Promise<"retry" | "close">;
  searchModels(
    search: (query: string, signal: AbortSignal) => Promise<HuggingFaceModel[]>,
  ): Promise<string | undefined>;
  showStatus(title: string, message: string): void;
  progress(state: ProgressState): Promise<void>;
  updateProgress(state: ProgressState): void;
}

class LlamaView implements LlamaUi, Focusable {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly searchCache = new Map<string, HuggingFaceModel[]>();
  private content: Container;
  private inputHandler: { handleInput?(data: string): void } | undefined;
  private inputTarget: Focusable | undefined;
  private progressPromise: Promise<void> | undefined;
  private progressResolver: (() => void) | undefined;
  private showingProgress = false;
  private isFocused = false;

  constructor(tui: TUI, theme: Theme, keybindings: KeybindingsManager) {
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
    content: Container,
    inputHandler?: { handleInput?(data: string): void },
    inputTarget?: Focusable,
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

  showModels(serverUrl: string, models: LlamaModelInfo[]): Promise<LlamaManagerAction> {
    const sorted = [...models].sort((left, right) => {
      const loaded =
        Number(right.status.value === "loaded") - Number(left.status.value === "loaded");
      return loaded || left.id.localeCompare(right.id);
    });
    const byId = new Map(sorted.map((model) => [model.id, model]));
    const items: SelectItem[] = [
      ...sorted.map((model) => ({
        value: model.id,
        label: model.id,
        description: modelDescription(model),
      })),
      {
        value: DOWNLOAD_VALUE,
        label: "Download model…",
        description: "Hugging Face owner/repository[:quant]",
      },
    ];
    return callbackPromise((resolve) => {
      const list = new SelectList(items, Math.min(items.length, 12), selectTheme(this.theme), {
        minPrimaryColumnWidth: 36,
        maxPrimaryColumnWidth: 56,
      });
      list.onSelect = (item) => {
        if (item.value === DOWNLOAD_VALUE) resolve({ type: "download" });
        else {
          const model = byId.get(item.value);
          if (model !== undefined) resolve({ type: "model", model });
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
        options.map((option) => ({ value: option, label: option })),
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
    search: (query: string, signal: AbortSignal) => Promise<HuggingFaceModel[]>,
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

  progress(state: ProgressState): Promise<void> {
    if (this.progressPromise === undefined) {
      this.progressPromise = callbackPromise((resolve) => {
        this.progressResolver = resolve;
      });
    }
    this.showingProgress = true;
    this.updateProgress(state);
    return this.progressPromise;
  }

  updateProgress(state: ProgressState): void {
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

function showLlamaUiImpl(
  ctx: ExtensionCommandContext,
  run: (ui: LlamaUi) => Promise<void>,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(
        ctx.ui.custom<void>((tui, theme, keybindings, done) => {
          const view = new LlamaView(tui, theme, keybindings);
          Effect.runFork(
            Effect.tryPromise(() => run(view)).pipe(
              Effect.catch((error) =>
                Effect.sync(() => ctx.ui.notify(toErrorMessage(error.cause), "error")),
              ),
              Effect.ensuring(Effect.sync(() => done())),
            ),
          );
          return view;
        }),
      );
    }),
  );
}

export const showLlamaUi: {
  (ctx: ExtensionCommandContext, run: (ui: LlamaUi) => Promise<void>): Promise<void>;
  (run: (ui: LlamaUi) => Promise<void>): (ctx: ExtensionCommandContext) => Promise<void>;
} = dual((args: IArguments) => args.length >= 2, showLlamaUiImpl);

function runWithProgressImpl<T>(
  ui: LlamaUi,
  options: {
    title: string;
    model: string;
    initialMessage: string;
    cancelTitle: string;
    cancelMessage: string;
    run(signal: AbortSignal, update: (progress: LlamaProgress) => void): Promise<T>;
    cancel(): Promise<void>;
  },
): Promise<{ cancelled: true } | { cancelled: false; value: T }> {
  return Effect.runPromise(
    awaiting(function* () {
      const controller = new AbortController();
      const state: ProgressState = {
        title: options.title,
        model: options.model,
        message: options.initialMessage,
      };
      const settled = options
        .run(controller.signal, (progress) => {
          Object.assign(state, progress);
          ui.updateProgress(state);
        })
        .then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
      const progress = { completed: false };
      settled.finally(() => {
        progress.completed = true;
      });

      while (!progress.completed) {
        const outcome = yield* awaited(
          Promise.race([
            settled.then(() => "settled" as const),
            ui.progress(state).then(() => "stop" as const),
          ]),
        );
        if (outcome === "settled") break;
        const stop = yield* awaited(ui.confirm(options.cancelTitle, options.cancelMessage));
        if (!stop || progress.completed) continue;
        try {
          yield* awaited(options.cancel());
        } finally {
          controller.abort(new Error("Cancelled"));
        }
        yield* awaited(settled);
        return { cancelled: true };
      }

      const result = yield* awaited(settled);
      if (!result.ok) throw result.error;
      return { cancelled: false, value: result.value };
    }),
  );
}

export const runWithProgress: {
  <T>(
    ui: LlamaUi,
    options: {
      title: string;
      model: string;
      initialMessage: string;
      cancelTitle: string;
      cancelMessage: string;
      run(signal: AbortSignal, update: (progress: LlamaProgress) => void): Promise<T>;
      cancel(): Promise<void>;
    },
  ): Promise<{ cancelled: true } | { cancelled: false; value: T }>;
  <T>(options: {
    title: string;
    model: string;
    initialMessage: string;
    cancelTitle: string;
    cancelMessage: string;
    run(signal: AbortSignal, update: (progress: LlamaProgress) => void): Promise<T>;
    cancel(): Promise<void>;
  }): (ui: LlamaUi) => Promise<{ cancelled: true } | { cancelled: false; value: T }>;
} = dual((args: IArguments) => args.length >= 2, runWithProgressImpl);
