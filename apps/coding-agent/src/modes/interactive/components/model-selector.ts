import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type modelSelectorInternalTypes from "./model-selector-internal.types.ts";
import type modelSelectorTypes from "./model-selector.types.ts";
import ModelCatalog from "./model-selector/model-catalog.ts";
import ModelInput from "./model-selector/model-input.ts";
import ModelList from "./model-selector/model-list.ts";
import ModelRefresh from "./model-selector/model-refresh.ts";
import ModelSelectorLayout from "./model-selector/model-selector-layout.ts";

export default class ModelSelectorComponent
  extends tuiModule.Container
  implements tuiTypes.Focusable
{
  readonly catalog: ModelCatalog;
  readonly list: ModelList;
  readonly refresh: ModelRefresh;
  readonly input: ModelInput;
  readonly layout: ModelSelectorLayout;

  searchInput!: tuiTypes.Input;

  private focusedState = false;

  listContainer!: tuiTypes.Container;

  allModels: modelSelectorInternalTypes.ModelItem[] = [];

  scopedModelItems: modelSelectorInternalTypes.ModelItem[] = [];

  hiddenModelItems: modelSelectorInternalTypes.ModelItem[] = [];

  activeModels: modelSelectorInternalTypes.ModelItem[] = [];

  filteredModels: modelSelectorInternalTypes.ModelItem[] = [];

  selectedIndex: number = 0;

  currentModel?: modelSelectorTypes.SelectableModel | undefined;

  modelRuntime!: modelSelectorTypes.ModelSource;

  onSelectCallback!: (model: modelSelectorTypes.SelectableModel) => void;

  onSelectAsDefaultCallback?: ((model: modelSelectorTypes.SelectableModel) => void) | undefined;

  onCancelCallback!: () => void;

  errorMessage?: string | undefined;

  refreshStatusMessage = "Refreshing model catalogs…";

  refreshStatusSuccess = false;

  tui!: tuiTypes.TUI;

  scopedModels!: ReadonlyArray<modelSelectorInternalTypes.ScopedModelItem>;

  defaultModel?: modelSelectorInternalTypes.DefaultModelReference | undefined;

  policyOptions?: modelSelectorTypes.ModelSelectorPolicyOptions | undefined;

  scope: modelSelectorInternalTypes.ModelScope = "all";

  scopeText?: tuiTypes.Text;

  scopeHintText?: tuiTypes.Text;

  policyHintText?: tuiTypes.Text;

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  dispose(): void {
    this.refresh.close();
  }

  handleSelect(model: modelSelectorTypes.SelectableModel): void {
    this.dispose();
    this.onSelectCallback(model);
  }

  getSearchInput(): tuiTypes.Input {
    return this.searchInput;
  }

  handleInput(keyData: string): void {
    this.input.handle(keyData);
  }

  constructor(
    tui: tuiTypes.TUI,
    currentModel: modelSelectorTypes.SelectableModel | undefined,
    modelRuntime: modelSelectorTypes.ModelSource,
    scopedModels: ReadonlyArray<modelSelectorInternalTypes.ScopedModelItem>,
    onSelect: (model: modelSelectorTypes.SelectableModel) => void,
    onCancel: () => void,
    initialSearchInput?: string,
    onSelectAsDefault?: (model: modelSelectorTypes.SelectableModel) => void,
    defaultModel?: modelSelectorInternalTypes.DefaultModelReference,
    policyOptions?: modelSelectorTypes.ModelSelectorPolicyOptions,
  ) {
    super();
    this.catalog = new ModelCatalog(this);
    this.list = new ModelList(this);
    this.refresh = new ModelRefresh(this);
    this.input = new ModelInput(this);
    this.layout = new ModelSelectorLayout(this);
    this.tui = tui;
    this.currentModel = currentModel;
    this.modelRuntime = modelRuntime;
    this.scopedModels = scopedModels;
    this.defaultModel = defaultModel;
    this.policyOptions = policyOptions;
    this.scope = scopedModels.length > 0 ? "scoped" : "all";
    this.onSelectCallback = onSelect;
    this.onSelectAsDefaultCallback = onSelectAsDefault;
    this.onCancelCallback = onCancel;
    this.layout.build(initialSearchInput);

    this.catalog.loadModelsFromSnapshot();
    if (initialSearchInput !== undefined && initialSearchInput !== "")
      this.list.filterModels(initialSearchInput);
    else this.list.updateList();
    this.tui.requestRender();
    void this.refresh.refreshModels();
  }
}
