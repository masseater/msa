import type aiTypes from "@msa/ai/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type ModelRuntime from "../../../core/model-runtime.ts";
import type modelRuntimeTypes from "../../../core/model-runtime.types.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import type modelSelectorInternalTypes from "./model-selector-internal.types.ts";
import ModelSelectorComponentLayer2 from "./model-selector-layer-2.ts";
import type modelSelectorTypes from "./model-selector.types.ts";

const { Container, Input, Spacer, Text } = tuiModule;
const { theme } = themeModule;
const { keyDisplayText } = keybindingHints;

export default class ModelSelectorComponent
  extends ModelSelectorComponentLayer2
  implements tuiTypes.Focusable
{
  constructor(
    tui: tuiTypes.TUI,
    currentModel: aiTypes.Model<any> | undefined,
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    scopedModels: ReadonlyArray<modelSelectorInternalTypes.ScopedModelItem>,
    onSelect: (model: aiTypes.Model<any>) => void,
    onCancel: () => void,
    initialSearchInput?: string,
    onSelectAsDefault?: (model: aiTypes.Model<any>) => void,
    defaultModel?: modelSelectorInternalTypes.DefaultModelReference,
    policyOptions?: modelSelectorTypes.ModelSelectorPolicyOptions,
  ) {
    super();

    this.tui = tui;
    this.constructPart2(
      policyOptions,
      currentModel,
      modelRuntime,
      scopedModels,
      defaultModel,
      onSelect,
      onSelectAsDefault,
      onCancel,
      initialSearchInput,
    );
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));

    if (this.onSelectAsDefaultCallback !== undefined) {
      this.addChild(
        new Text(
          theme.fg(
            "dim",
            `  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("app.models.save")} to set as default · ${keyDisplayText("tui.select.cancel")} to cancel`,
          ),
          0,
          0,
        ),
      );
    }

    if (policyOptions !== undefined) {
      this.policyHintText = new Text(this.getPolicyHintText(), 0, 0);
      this.addChild(this.policyHintText);
    }

    this.addChild(new DynamicBorder());

    this.loadModelsFromSnapshot();
    if (initialSearchInput !== undefined && initialSearchInput !== "")
      this.filterModels(initialSearchInput);
    else this.updateList();
    this.tui.requestRender();
    void this.refreshModels();
  }

  private constructPart2(
    policyOptions: modelSelectorTypes.ModelSelectorPolicyOptions | undefined,
    currentModel: aiTypes.Model<any> | undefined,
    modelRuntime: ModelRuntime,
    scopedModels: readonly modelSelectorInternalTypes.ScopedModelItem[],
    defaultModel: modelSelectorInternalTypes.DefaultModelReference | undefined,
    onSelect: (model: aiTypes.Model<any>) => void,
    onSelectAsDefault: ((model: aiTypes.Model<any>) => void) | undefined,
    onCancel: () => void,
    initialSearchInput: string | undefined,
  ) {
    this.constructPart1(
      policyOptions,
      currentModel,
      modelRuntime,
      scopedModels,
      defaultModel,
      onSelect,
      onSelectAsDefault,
      onCancel,
      initialSearchInput,
    );
  }

  private constructPart1(
    policyOptions: modelSelectorTypes.ModelSelectorPolicyOptions | undefined,
    currentModel: aiTypes.Model<any> | undefined,
    modelRuntime: ModelRuntime,
    scopedModels: readonly modelSelectorInternalTypes.ScopedModelItem[],
    defaultModel: modelSelectorInternalTypes.DefaultModelReference | undefined,
    onSelect: (model: aiTypes.Model<any>) => void,
    onSelectAsDefault: ((model: aiTypes.Model<any>) => void) | undefined,
    onCancel: () => void,
    initialSearchInput: string | undefined,
  ) {
    this.constructPart1Part1(policyOptions, currentModel, modelRuntime, scopedModels, defaultModel);
    this.onSelectCallback = onSelect;
    this.onSelectAsDefaultCallback = onSelectAsDefault;
    this.onCancelCallback = onCancel;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    if (scopedModels.length > 0 || policyOptions !== undefined) {
      this.scopeText = new Text(this.getScopeText(), 0, 0);
      this.addChild(this.scopeText);
      this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
      this.addChild(this.scopeHintText);
    } else {
      const hintText =
        "Only showing models from configured providers. Use /login to add providers.";
      this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
    }
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    if (initialSearchInput !== undefined && initialSearchInput !== "") {
      this.searchInput.setValue(initialSearchInput);
    }
    this.searchInput.onSubmit = () => {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected !== undefined) {
        this.handleSelect(selected.model);
      }
    };
    this.addChild(this.searchInput);

    this.addChild(new Spacer(1));

    this.listContainer = new Container();
  }

  private constructPart1Part1(
    policyOptions: modelSelectorTypes.ModelSelectorPolicyOptions | undefined,
    currentModel: aiTypes.Model<any> | undefined,
    modelRuntime: ModelRuntime,
    scopedModels: readonly modelSelectorInternalTypes.ScopedModelItem[],
    defaultModel: modelSelectorInternalTypes.DefaultModelReference | undefined,
  ) {
    this.policyOptions = policyOptions;
    this.currentModel = currentModel;
    this.modelRuntime = modelRuntime;
    this.scopedModels = scopedModels;
    this.defaultModel = defaultModel;
    this.scope = scopedModels.length > 0 ? "scoped" : "all";
  }
}
