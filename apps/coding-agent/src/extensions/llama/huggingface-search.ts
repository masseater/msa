import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { awaited, awaitingWith } from "../../core/awaiting.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { type Scheduled, schedule } from "../../core/platform.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import type { HuggingFaceModel } from "./huggingface.ts";

const { Container, Input, Spacer, Text, fuzzyFilter } = tuiModule;

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(value);
}

export class HuggingFaceSearch extends Container implements tuiTypes.Focusable {
  private readonly tui: tuiTypes.TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly search: (query: string, signal: AbortSignal) => Promise<HuggingFaceModel[]>;
  private readonly cache: Map<string, HuggingFaceModel[]>;
  private readonly onSelectModel: (model: string | undefined) => void;
  private readonly input = new Input();
  private readonly resultsContainer = new Container();
  private results: HuggingFaceModel[] = [];
  private filteredResults: HuggingFaceModel[] = [];
  private selectedIndex = 0;
  private query = "";
  private status = "Type at least 2 characters";
  private debounce: Scheduled | undefined;
  private request: AbortController | undefined;
  private closed = false;
  private isFocused = false;

  constructor(
    tui: tuiTypes.TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    search: (query: string, signal: AbortSignal) => Promise<HuggingFaceModel[]>,
    cache: Map<string, HuggingFaceModel[]>,
    onSelectModel: (model: string | undefined) => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.search = search;
    this.cache = cache;
    this.onSelectModel = onSelectModel;
    this.addChild(new Text(theme.fg("dim", "Model name or owner/repository[:quant]"), 1, 0));
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(this.resultsContainer);
    this.updateResults();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.input.focused = value;
  }

  private updateResults(): void {
    this.resultsContainer.clear();
    const maxVisible = 10;
    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        this.filteredResults.length - maxVisible,
      ),
    );
    const end = Math.min(start + maxVisible, this.filteredResults.length);
    for (let index = start; index < end; index++) {
      const model = this.filteredResults[index];
      if (model === undefined) continue;
      const prefix = index === this.selectedIndex ? "→ " : "  ";
      const details = `${compactCount(model.downloads)} downloads`;
      this.resultsContainer.addChild(
        new Text(
          index === this.selectedIndex
            ? this.theme.fg("accent", `${prefix}${model.id}  ${details}`)
            : `${prefix}${model.id}${this.theme.fg("muted", `  ${details}`)}`,
          0,
          0,
        ),
      );
    }
    if (start > 0 || end < this.filteredResults.length) {
      this.resultsContainer.addChild(
        new Text(
          this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.filteredResults.length})`),
          0,
          0,
        ),
      );
    }
    if (this.filteredResults.length === 0) {
      this.resultsContainer.addChild(new Text(this.theme.fg("dim", `  ${this.status}`), 0, 0));
    } else if (this.status === "Searching Hugging Face…") {
      this.resultsContainer.addChild(new Text(this.theme.fg("dim", `  ${this.status}`), 0, 0));
    }
    this.tui.requestRender();
  }

  private filterResults(): void {
    if (this.query === "") {
      this.filteredResults = this.results;
    } else {
      const matches = new Set(
        fuzzyFilter(this.results, this.query, (model) => model.id).map((model) => model.id),
      );
      this.filteredResults = this.results.filter((model) => matches.has(model.id));
    }
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredResults.length - 1));
    this.updateResults();
  }

  private scheduleSearch(): void {
    this.debounce?.cancel();
    this.request?.abort();
    this.request = undefined;
    if (this.query.length < 2) {
      this.status = "Type at least 2 characters";
      this.filterResults();
      return;
    }
    const cached = this.cache.get(this.query.toLowerCase());
    if (cached !== undefined) {
      this.results = cached;
      this.status = cached.length === 0 ? "No GGUF models found" : "";
      this.filterResults();
      return;
    }
    this.status = "Searching Hugging Face…";
    this.filterResults();
    this.debounce = schedule(() => void this.runSearch(this.query), 500);
  }

  private runSearch(query: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const request = new AbortController();
        this.request = request;
        try {
          const results = yield* awaited(this.search(query, request.signal));
          this.cache.set(query.toLowerCase(), results);
          if (this.closed || request.signal.aborted || this.query !== query) return;
          this.results = results;
          this.selectedIndex = 0;
          this.status = results.length === 0 ? "No GGUF models found" : "";
          this.filterResults();
        } catch (error) {
          if (this.closed || request.signal.aborted || this.query !== query) return;
          this.results = [];
          this.status = toErrorMessage(error);
          this.filterResults();
        } finally {
          if (this.request === request) this.request = undefined;
        }
      }, this),
    );
  }

  private close(model: string | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.debounce?.cancel();
    this.request?.abort();
    this.onSelectModel(model);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (this.filteredResults.length > 0) {
        this.selectedIndex =
          this.selectedIndex === 0 ? this.filteredResults.length - 1 : this.selectedIndex - 1;
        this.updateResults();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (this.filteredResults.length > 0) {
        this.selectedIndex =
          this.selectedIndex === this.filteredResults.length - 1 ? 0 : this.selectedIndex + 1;
        this.updateResults();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const exact = /^[^/\s]+\/[^:\s]+(?::[^\s:]+)?$/u.test(this.query) ? this.query : undefined;
      const selected = exact ?? this.filteredResults[this.selectedIndex]?.id;
      if (selected !== undefined && selected !== "") this.close(selected);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(undefined);
      return;
    }
    this.input.handleInput(data);
    const query = this.input.getValue().trim();
    if (query === this.query) return;
    this.query = query;
    this.scheduleSearch();
  }
}
