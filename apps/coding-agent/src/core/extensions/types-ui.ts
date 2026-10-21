import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type compactionTypes from "../compaction/index.types.ts";
import type footerDataProviderTypes from "../footer-data-provider.types.ts";
import type keybindingsTypes from "../keybindings.types.ts";

declare namespace typesUiTypes {
  interface ExtensionUIDialogOptions {
    signal?: AbortSignal;
    timeout?: number;
  }

  type WidgetPlacement = "aboveEditor" | "belowEditor";

  interface ExtensionWidgetOptions {
    placement?: WidgetPlacement;
  }

  type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

  interface WorkingIndicatorOptions {
    frames?: string[];
    intervalMs?: number;
  }

  type AutocompleteProviderFactory = (
    current: tuiTypes.AutocompleteProvider,
  ) => tuiTypes.AutocompleteProvider;

  type EditorFactory = (
    tui: tuiTypes.TUI,
    theme: tuiTypes.EditorTheme,
    keybindings: keybindingsTypes.KeybindingsManager,
  ) => tuiTypes.EditorComponent;

  interface ExtensionUIContext {
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
        | ((
            tui: tuiTypes.TUI,
            theme: themeTypes.Theme,
          ) => tuiTypes.Component & { dispose?(): void })
        | undefined,
      options?: ExtensionWidgetOptions,
    ): void;

    setFooter(
      factory:
        | ((
            tui: tuiTypes.TUI,
            theme: themeTypes.Theme,
            footerData: footerDataProviderTypes.ReadonlyFooterDataProvider,
          ) => tuiTypes.Component & { dispose?(): void })
        | undefined,
    ): void;

    setHeader(
      factory:
        | ((
            tui: tuiTypes.TUI,
            theme: themeTypes.Theme,
          ) => tuiTypes.Component & { dispose?(): void })
        | undefined,
    ): void;

    setTitle(title: string): void;

    custom<T>(
      factory: (
        tui: tuiTypes.TUI,
        theme: themeTypes.Theme,
        keybindings: keybindingsTypes.KeybindingsManager,
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

    readonly theme: themeTypes.Theme;

    getAllThemes(): { name: string; path: string | undefined }[];

    getTheme(name: string): themeTypes.Theme | undefined;

    setTheme(theme: string | themeTypes.Theme): { success: boolean; error?: string };

    getToolsExpanded(): boolean;

    setToolsExpanded(expanded: boolean): void;
  }

  interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  }

  interface CompactOptions {
    customInstructions?: string;
    onComplete?: (result: compactionTypes.CompactionResult) => void;
    onError?: (error: Error) => void;
  }

  type ExtensionMode = "tui" | "rpc" | "json" | "print";
}

export type { typesUiTypes as default };
