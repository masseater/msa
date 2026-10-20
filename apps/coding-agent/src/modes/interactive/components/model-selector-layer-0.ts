import type aiTypes from "@msa/ai/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import type { Fiber } from "effect";

import type modelRuntimeTypes from "../../../core/model-runtime.types.ts";
import type modelSelectorInternalTypes from "./model-selector-internal.types.ts";
import type modelSelectorTypes from "./model-selector.types.ts";

export default abstract class ModelSelectorComponentLayer0 extends tuiModule.Container {
  protected searchInput!: tuiTypes.Input;
  protected focusedState = false;
  protected listContainer!: tuiTypes.Container;
  protected allModels: modelSelectorInternalTypes.ModelItem[] = [];
  protected scopedModelItems: modelSelectorInternalTypes.ModelItem[] = [];
  protected hiddenModelItems: modelSelectorInternalTypes.ModelItem[] = [];
  protected activeModels: modelSelectorInternalTypes.ModelItem[] = [];
  protected filteredModels: modelSelectorInternalTypes.ModelItem[] = [];
  protected selectedIndex: number = 0;
  protected currentModel?: aiTypes.Model<any> | undefined;
  protected modelRuntime!: modelRuntimeTypes.ModelRuntime;
  protected onSelectCallback!: (model: aiTypes.Model<any>) => void;
  protected onSelectAsDefaultCallback?: ((model: aiTypes.Model<any>) => void) | undefined;
  protected onCancelCallback!: () => void;
  protected errorMessage?: string | undefined;
  protected refreshStatusMessage = "Refreshing model catalogs…";
  protected refreshStatusSuccess = false;
  protected tui!: tuiTypes.TUI;
  protected scopedModels!: ReadonlyArray<modelSelectorInternalTypes.ScopedModelItem>;
  protected defaultModel?: modelSelectorInternalTypes.DefaultModelReference | undefined;
  protected policyOptions?: modelSelectorTypes.ModelSelectorPolicyOptions | undefined;
  protected scope: modelSelectorInternalTypes.ModelScope = "all";
  protected scopeText?: tuiTypes.Text;
  protected scopeHintText?: tuiTypes.Text;
  protected policyHintText?: tuiTypes.Text;
  protected readonly refreshAbortController = new AbortController();
  protected refreshTimeout: Fiber.Fiber<void> | undefined;
  protected closed = false;
}
