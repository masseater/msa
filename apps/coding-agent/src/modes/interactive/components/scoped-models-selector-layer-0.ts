import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type scopedModelsSelectorInternalTypes from "./scoped-models-selector-internal.types.ts";
import type scopedModelsSelectorTypes from "./scoped-models-selector.types.ts";

export default abstract class ScopedModelsSelectorComponentLayer0 extends tui.Container {
  protected modelsById: Map<string, aiTypes.Model<any>> = new Map();
  protected allIds: string[] = [];
  protected enabledIds: scopedModelsSelectorInternalTypes.EnabledIds = null;
  filteredItems: scopedModelsSelectorInternalTypes.ModelItem[] = [];
  selectedIndex = 0;
  protected searchInput!: tuiTypes.Input;
  protected focusedState = false;
  listContainer!: tuiTypes.Container;
  protected footerText!: tuiTypes.Text;
  protected callbacks!: scopedModelsSelectorTypes.ModelsCallbacks;
  maxVisible = 8;
  protected isDirty = false;
  protected refreshStatusText?: tuiTypes.Text;
}
