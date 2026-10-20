import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import modelSearch from "../model-search.ts";
import themeModule from "../theme/theme.ts";
import type scopedModelsSelectorInternalTypes from "./scoped-models-selector-internal.types.ts";
import type scopedModelsSelectorTypes from "./scoped-models-selector.types.ts";
import ScopedModelsInput from "./scoped-models-selector/scoped-models-input.ts";
import ScopedModelsView from "./scoped-models-selector/scoped-models-view.ts";

const { theme } = themeModule;
const { fuzzyFilter } = tui;
const { getModelSearchText } = modelSearch;

export default class ScopedModelsSelectorComponent
  extends tui.Container
  implements tuiTypes.Focusable
{
  readonly input: ScopedModelsInput;
  readonly view: ScopedModelsView;

  modelsById: Map<string, aiTypes.Model<any>> = new Map();

  allIds: string[] = [];

  enabledIds: scopedModelsSelectorInternalTypes.EnabledIds = null;

  filteredItems: scopedModelsSelectorInternalTypes.ModelItem[] = [];

  selectedIndex = 0;

  searchInput!: tuiTypes.Input;

  private focusedState = false;

  listContainer!: tuiTypes.Container;

  footerText!: tuiTypes.Text;

  callbacks!: scopedModelsSelectorTypes.ModelsCallbacks;

  maxVisible = 8;

  isDirty = false;

  refreshStatusText?: tuiTypes.Text;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  updateModels(models: readonly aiTypes.Model<any>[], enabledModelIds?: string[] | null): void {
    const selectedId = this.filteredItems[this.selectedIndex]?.fullId;
    if (enabledModelIds !== undefined)
      this.enabledIds = enabledModelIds === null ? null : [...enabledModelIds];
    this.modelsById.clear();
    this.allIds = [];
    for (const model of models) {
      const fullId = `${model.provider}/${model.id}`;
      this.modelsById.set(fullId, model);
      this.allIds.push(fullId);
    }
    this.refresh();
    const refreshedIndex =
      selectedId !== undefined && selectedId !== ""
        ? this.filteredItems.findIndex((item) => item.fullId === selectedId)
        : -1;
    if (refreshedIndex >= 0) {
      this.selectedIndex = refreshedIndex;
      this.view.updateList();
    }
  }

  setRefreshStatus(message: string, kind: "muted" | "success" | "warning"): void {
    this.refreshStatusText?.setText(theme.fg(kind, `  ${message}`));
  }

  refresh(): void {
    const query = this.searchInput.getValue();
    const items = this.view.buildItems();
    this.filteredItems =
      query === ""
        ? items
        : fuzzyFilter(items, query, (item) =>
            item.model === undefined
              ? item.fullId
              : getModelSearchText({
                  id: item.model.id,
                  name: item.model.name,
                  provider: item.model.provider,
                }),
          );
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
    this.view.updateList();
    this.footerText.setText(this.view.getFooterText());
  }

  notifyChange(): void {
    this.callbacks.onChange(this.enabledIds === null ? null : [...this.enabledIds]);
  }

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  constructor(
    config: scopedModelsSelectorTypes.ModelsConfig,
    callbacks: scopedModelsSelectorTypes.ModelsCallbacks,
  ) {
    super();
    this.input = new ScopedModelsInput(this);
    this.view = new ScopedModelsView(this);
    this.callbacks = callbacks;

    for (const model of config.allModels) {
      const fullId = `${model.provider}/${model.id}`;
      this.modelsById.set(fullId, model);
      this.allIds.push(fullId);
    }

    this.enabledIds = config.enabledModelIds === null ? null : [...config.enabledModelIds];
    this.filteredItems = this.view.buildItems();

    this.view.build(config.refreshStatus);
    this.view.updateList();
  }
}
