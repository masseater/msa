import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import ConfigSelectorHeader from "./config-selector-header.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import DynamicBorder from "./dynamic-border.ts";
import resourceGroups from "./resource-groups.ts";
import ResourceList from "./resource-list.ts";

const { buildResourceGroups } = resourceGroups;
const { Spacer } = tui;

export default class ConfigSelectorComponent extends tui.Container implements tuiTypes.Focusable {
  private header: ConfigSelectorHeader;
  private resourceList: ResourceList;
  private writeScope: configSelectorTypes.ConfigWriteScope;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.resourceList.focused = value;
  }

  constructor(
    resolvedPaths: configSelectorTypes.ScopedResolvedPaths,
    settingsManager: settingsManagerTypes.SettingsManager,
    cwd: string,
    agentDir: string,
    onClose: () => void,
    onExit: () => void,
    requestRender: () => void,
    terminalHeight?: number,
    writeScope: configSelectorTypes.ConfigWriteScope = "global",
    projectModeAvailable = true,
  ) {
    super();

    this.writeScope = writeScope;
    const groupsByScope = {
      global: buildResourceGroups(resolvedPaths.global, agentDir),
      project: buildResourceGroups(resolvedPaths.project, agentDir),
    };

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.header = new ConfigSelectorHeader(this.writeScope, projectModeAvailable);
    this.addChild(this.header);
    this.addChild(new Spacer(1));

    this.resourceList = new ResourceList(
      groupsByScope,
      settingsManager,
      cwd,
      agentDir,
      terminalHeight,
      this.writeScope,
    );
    this.resourceList.onCancel = onClose;
    this.resourceList.onExit = onExit;
    this.resourceList.onToggle = () => requestRender();
    if (projectModeAvailable) {
      this.resourceList.onSwitchMode = () => {
        this.switchWriteScope();
        requestRender();
      };
    }
    this.addChild(this.resourceList);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  private switchWriteScope(): void {
    this.writeScope = this.writeScope === "global" ? "project" : "global";
    this.header.setWriteScope(this.writeScope);
    this.resourceList.setWriteScope(this.writeScope);
  }

  getResourceList(): ResourceList {
    return this.resourceList;
  }
}
