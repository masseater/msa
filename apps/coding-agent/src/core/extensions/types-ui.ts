import type tuiTypes from "@msa/tui/index.types";

import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { CompactionResult } from "../compaction/index.ts";
import type { ReadonlyFooterDataProvider } from "../footer-data-provider.ts";
import type { KeybindingsManager } from "../keybindings.ts";

export interface ExtensionUIDialogOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface ExtensionWidgetOptions {
  placement?: WidgetPlacement;
}

export type TerminalInputHandler = (
  data: string,
) => { consume?: boolean; data?: string } | undefined;

export interface WorkingIndicatorOptions {
  frames?: string[];
  intervalMs?: number;
}

export type AutocompleteProviderFactory = (
  current: tuiTypes.AutocompleteProvider,
) => tuiTypes.AutocompleteProvider;
export type EditorFactory = (
  tui: tuiTypes.TUI,
  theme: tuiTypes.EditorTheme,
  keybindings: KeybindingsManager,
) => tuiTypes.EditorComponent;

export interface ExtensionUIContext {
  select(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined>;

  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;

  input(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined>;

  notify(message: string, type?: "info" | "warning" | "error"): void;

  onTerminalInput(handler: TerminalInputHandler): () => void;

  setStatus(key: string, text: string | undefined): void;

  setWorkingMessage(message?: string): void;

  setWorkingVisible(visible: boolean): void;

  setWorkingIndicator(options?: WorkingIndicatorOptions): void;

  setHiddenThinkingLabel(label?: string): void;

  setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
  setWidget(
    key: string,
    content:
      | ((tui: tuiTypes.TUI, theme: Theme) => tuiTypes.Component & { dispose?(): void })
      | undefined,
    options?: ExtensionWidgetOptions,
  ): void;

  setFooter(
    factory:
      | ((
          tui: tuiTypes.TUI,
          theme: Theme,
          footerData: ReadonlyFooterDataProvider,
        ) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void;

  setHeader(
    factory:
      | ((tui: tuiTypes.TUI, theme: Theme) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void;

  setTitle(title: string): void;

  custom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | (tuiTypes.Component & { dispose?(): void })
      | Promise<tuiTypes.Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: tuiTypes.OverlayOptions | (() => tuiTypes.OverlayOptions);
      onHandle?: (handle: tuiTypes.OverlayHandle) => void;
    },
  ): Promise<T>;

  pasteToEditor(text: string): void;

  setEditorText(text: string): void;

  getEditorText(): string;

  editor(title: string, prefill?: string): Promise<string | undefined>;

  addAutocompleteProvider(factory: AutocompleteProviderFactory): void;

  setEditorComponent(factory: EditorFactory | undefined): void;

  getEditorComponent(): EditorFactory | undefined;

  readonly theme: Theme;

  getAllThemes(): { name: string; path: string | undefined }[];

  getTheme(name: string): Theme | undefined;

  setTheme(theme: string | Theme): { success: boolean; error?: string };

  getToolsExpanded(): boolean;

  setToolsExpanded(expanded: boolean): void;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: CompactionResult) => void;
  onError?: (error: Error) => void;
}

export type ExtensionMode = "tui" | "rpc" | "json" | "print";
