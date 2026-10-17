import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "../autocomplete.ts";
import type { KeybindingsManager } from "../keybindings.ts";
import { cjkBreakRegex } from "../text-boundaries.ts";
import {
  type AutocompleteRequestOptions,
  AutocompleteRequests,
} from "./editor-autocomplete-requests.ts";
import {
  AutocompleteTriggers,
  bestAutocompleteMatchIndex,
} from "./editor-autocomplete-triggers.ts";
import type { EditorDocument } from "./editor-document.ts";
import { SelectList, type SelectListLayoutOptions, type SelectListTheme } from "./select-list.ts";

const SLASH_COMMAND_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
};

export class EditorAutocomplete {
  maxVisible: number;
  readonly doc: EditorDocument;
  private readonly theme: SelectListTheme;
  private readonly requestRender: () => void;
  private readonly triggers = new AutocompleteTriggers();
  private readonly requests: AutocompleteRequests;
  private currentProvider: AutocompleteProvider | undefined;
  private list: SelectList | undefined;
  private state: "regular" | "force" | null = null;
  private prefix = "";

  constructor(
    doc: EditorDocument,
    options: { theme: SelectListTheme; maxVisible: number; requestRender: () => void },
  ) {
    this.doc = doc;
    this.theme = options.theme;
    this.maxVisible = options.maxVisible;
    this.requestRender = options.requestRender;
    this.requests = new AutocompleteRequests(this);
  }

  provider(): AutocompleteProvider | undefined {
    return this.currentProvider;
  }

  setProvider(provider: AutocompleteProvider): void {
    this.cancel();
    this.currentProvider = provider;
    this.triggers.set(provider.triggerCharacters ?? []);
  }

  isShowing(): boolean {
    return this.state !== null;
  }

  visibleList(): SelectList | undefined {
    return this.state === null ? undefined : this.list;
  }

  cancel(): void {
    this.requests.cancel();
    this.state = null;
    this.list = undefined;
    this.prefix = "";
  }

  refreshIfOpen(): void {
    if (this.state === null || this.currentProvider === undefined) return;
    this.request({ force: this.state === "force", explicitTab: false });
  }

  afterInsert(char: string): void {
    if (this.state === null) {
      this.autoTrigger(char);
    } else {
      this.refreshIfOpen();
    }
  }

  afterDeletion(): void {
    if (this.state !== null) {
      this.refreshIfOpen();
      return;
    }
    const textBeforeCursor = this.doc.textBeforeCursor();
    if (this.isInSlashCommandContext(textBeforeCursor) || this.triggers.matches(textBeforeCursor)) {
      this.request({ force: false, explicitTab: false });
    }
  }

  handleTab(): void {
    if (this.currentProvider === undefined) return;
    const beforeCursor = this.doc.textBeforeCursor();
    const slashCommand =
      this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ");
    this.request({ force: !slashCommand, explicitTab: true });
  }

  handleKey(data: string, kb: KeybindingsManager): boolean {
    const list = this.visibleList();
    if (list === undefined) return false;
    if (kb.matches(data, "tui.select.cancel")) {
      this.cancel();
      return true;
    }
    if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
      list.handleInput(data);
      return true;
    }
    const isTab = kb.matches(data, "tui.input.tab");
    if (!isTab && !kb.matches(data, "tui.select.confirm")) return false;
    const selected = list.getSelectedItem();
    if (selected === null || this.currentProvider === undefined) return isTab;
    this.applyItem(this.currentProvider, selected, this.prefix);
    const keepsInput = !isTab && this.prefix.startsWith("/");
    this.cancel();
    if (keepsInput) return false;
    this.doc.changed();
    return true;
  }

  deliver(
    provider: AutocompleteProvider,
    suggestions: AutocompleteSuggestions | null,
    options: AutocompleteRequestOptions,
  ): void {
    if (
      suggestions === null ||
      !Array.isArray(suggestions.items) ||
      suggestions.items.length === 0
    ) {
      this.cancel();
      this.requestRender();
      return;
    }
    if (options.force && options.explicitTab && suggestions.items.length === 1) {
      this.applyItem(provider, suggestions.items[0]!, suggestions.prefix);
      this.doc.changed();
      this.requestRender();
      return;
    }
    this.prefix = suggestions.prefix;
    this.list = this.createList(suggestions.prefix, suggestions.items);
    const bestMatchIndex = bestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
    if (bestMatchIndex >= 0) {
      this.list.setSelectedIndex(bestMatchIndex);
    }
    this.state = options.force ? "force" : "regular";
    this.requestRender();
  }

  private applyItem(provider: AutocompleteProvider, item: AutocompleteItem, prefix: string): void {
    this.doc.pushUndoSnapshot();
    this.doc.lastAction = null;
    const { state } = this.doc;
    this.doc.applyCompletion(
      provider.applyCompletion(state.lines, state.cursorLine, state.cursorCol, item, prefix),
    );
  }

  private createList(prefix: string, items: AutocompleteItem[]): SelectList {
    const layout = prefix.startsWith("/") ? SLASH_COMMAND_SELECT_LIST_LAYOUT : undefined;
    const list = new SelectList(items, this.maxVisible, this.theme, layout);
    list.onSelect = (selected) => {
      if (this.currentProvider === undefined) return;
      this.applyItem(this.currentProvider, selected, this.prefix);
      this.cancel();
      this.doc.changed();
    };
    return list;
  }

  private isSlashMenuAllowed(): boolean {
    return this.doc.state.cursorLine === 0;
  }

  private isAtStartOfMessage(): boolean {
    if (!this.isSlashMenuAllowed()) return false;
    const beforeCursor = this.doc.textBeforeCursor();
    return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
  }

  private isInSlashCommandContext(textBeforeCursor: string): boolean {
    return this.isSlashMenuAllowed() && textBeforeCursor.trimStart().startsWith("/");
  }

  private autoTrigger(char: string): void {
    if (char === "/" && this.isAtStartOfMessage()) {
      this.request({ force: false, explicitTab: false });
      return;
    }
    const textBeforeCursor = this.doc.textBeforeCursor();
    if (this.triggers.isTriggerCharacter(char)) {
      if (this.triggers.matches(textBeforeCursor)) {
        this.request({ force: false, explicitTab: false });
      }
      return;
    }
    if (
      (/[a-zA-Z0-9.\-_]/u.test(char) || cjkBreakRegex.test(char)) &&
      (this.isInSlashCommandContext(textBeforeCursor) || this.triggers.matches(textBeforeCursor))
    ) {
      this.request({ force: false, explicitTab: false });
    }
  }

  private request(options: AutocompleteRequestOptions): void {
    const provider = this.currentProvider;
    if (provider === undefined) return;
    if (options.force) {
      const { state } = this.doc;
      const shouldTrigger =
        provider.shouldTriggerFileCompletion === undefined ||
        provider.shouldTriggerFileCompletion(state.lines, state.cursorLine, state.cursorCol);
      if (!shouldTrigger) return;
    }
    const debounceMs =
      options.explicitTab || options.force
        ? 0
        : this.triggers.debounceMs(this.doc.textBeforeCursor());
    this.requests.request(options, debounceMs);
  }
}
