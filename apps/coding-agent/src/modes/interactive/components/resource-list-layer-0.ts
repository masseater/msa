import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";

export default abstract class ResourceListLayer0 {
  protected groupsByScope!: Record<
    configSelectorTypes.ConfigWriteScope,
    resourceListInternalTypes.ResourceGroup[]
  >;
  protected flatItems: resourceListInternalTypes.FlatEntry[] = [];
  protected filteredItems: resourceListInternalTypes.FlatEntry[] = [];
  protected selectedIndex = 0;
  protected searchInput!: tuiTypes.Input;
  protected maxVisible!: number;
  settingsManager!: settingsManagerTypes.SettingsManager;
  protected cwd!: string;
  protected agentDir!: string;
  protected writeScope!: configSelectorTypes.ConfigWriteScope;
  protected inheritedEnabledByKey!: Map<string, boolean>;
  public onCancel?: () => void;
  public onExit?: () => void;
  public onToggle?: (item: resourceListInternalTypes.ResourceItem, newEnabled: boolean) => void;
  public onSwitchMode?: () => void;
  protected focusedState = false;
}
