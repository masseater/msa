import type autocompleteTypes from "../autocomplete.types.ts";
import type keybindingsTypes from "../keybindings.types.ts";
import textBoundaries from "../text-boundaries.ts";
import AutocompleteRequests from "./editor-autocomplete-requests.ts";
import type editorAutocompleteRequestsTypes from "./editor-autocomplete-requests.types.ts";
import editorAutocompleteTriggers from "./editor-autocomplete-triggers.ts";
import type editorDocumentTypes from "./editor-document.types.ts";
import SelectList from "./select-list.ts";
import type selectListTypes from "./select-list.types.ts";

const { AutocompleteTriggers, bestAutocompleteMatchIndex } = editorAutocompleteTriggers;

const { cjkBreakRegex } = textBoundaries;

const SLASH_COMMAND_SELECT_LIST_LAYOUT: selectListTypes.SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 32,
  minPrimaryColumnWidth: 12,
};

export default class EditorAutocomplete {
  maxVisible: number;
  readonly doc: editorDocumentTypes.EditorDocument;
  private readonly theme: selectListTypes.SelectListTheme;
  private readonly requestRender: () => void;
  private readonly triggers = new AutocompleteTriggers();
  private readonly requests: editorAutocompleteRequestsTypes.AutocompleteRequests;
  private currentProvider: autocompleteTypes.AutocompleteProvider | undefined;
  private list: selectListTypes.SelectList | undefined;
  private state: "regular" | "force" | null = null;
  private prefix = "";

  constructor(
    doc: editorDocumentTypes.EditorDocument,
    options: {
      theme: selectListTypes.SelectListTheme;
      maxVisible: number;
      requestRender: () => void;
    },
  ) {
    this.doc = doc;
    this.theme = options.theme;
    this.maxVisible = options.maxVisible;
    this.requestRender = options.requestRender;
    this.requests = new AutocompleteRequests(this);
  }

  provider(): autocompleteTypes.AutocompleteProvider | undefined {
    return this.currentProvider;
  }

  setProvider(provider: autocompleteTypes.AutocompleteProvider): void {
    this.cancel();
    this.currentProvider = provider;
    this.triggers.set(provider.triggerCharacters ?? []);
  }

  isShowing(): boolean {
    return this.state !== null;
  }

  visibleList(): selectListTypes.SelectList | undefined {
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
    this.request({ explicitTab: false, force: this.state === "force" });
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
      this.request({ explicitTab: false, force: false });
    }
  }

  handleTab(): void {
    if (this.currentProvider === undefined) return;
    const beforeCursor = this.doc.textBeforeCursor();
    const slashCommand =
      this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ");
    this.request({ explicitTab: true, force: !slashCommand });
  }

  handleKey(data: string, kb: keybindingsTypes.KeybindingsManager): boolean {
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
    provider: autocompleteTypes.AutocompleteProvider,
    suggestions: autocompleteTypes.AutocompleteSuggestions | null,
    options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions,
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

  private applyItem(
    provider: autocompleteTypes.AutocompleteProvider,
    item: autocompleteTypes.AutocompleteItem,
    prefix: string,
  ): void {
    this.doc.pushUndoSnapshot();
    this.doc.lastAction = null;
    const { state } = this.doc;
    this.doc.applyCompletion(
      provider.applyCompletion(state.lines, state.cursorLine, state.cursorCol, item, prefix),
    );
  }

  private createList(
    prefix: string,
    items: autocompleteTypes.AutocompleteItem[],
  ): selectListTypes.SelectList {
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
      this.request({ explicitTab: false, force: false });
      return;
    }
    const textBeforeCursor = this.doc.textBeforeCursor();
    if (this.triggers.isTriggerCharacter(char)) {
      if (this.triggers.matches(textBeforeCursor)) {
        this.request({ explicitTab: false, force: false });
      }
      return;
    }
    if (
      (/[a-zA-Z0-9.\-_]/u.test(char) || cjkBreakRegex.test(char)) &&
      (this.isInSlashCommandContext(textBeforeCursor) || this.triggers.matches(textBeforeCursor))
    ) {
      this.request({ explicitTab: false, force: false });
    }
  }

  private request(options: editorAutocompleteRequestsTypes.AutocompleteRequestOptions): void {
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
