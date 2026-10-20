import type InteractiveMode from "../interactive-mode.ts";
import ForkSelector from "./fork-selector.ts";
import SessionSelectors from "./session-selectors.ts";
import SettingsCallbacks from "./settings-callbacks.ts";
import SettingsSelector from "./settings-selector.ts";
import ToolViews from "./tool-views.ts";
import TreeNavigation from "./tree-navigation.ts";
import TrustSelection from "./trust-selection.ts";

export default class ModeSelectors {
  readonly trust: TrustSelection;
  readonly fork: ForkSelector;
  readonly tree: TreeNavigation;
  readonly sessions: SessionSelectors;
  readonly settings: SettingsSelector;
  readonly settingsCallbacks: SettingsCallbacks;
  readonly views: ToolViews;

  constructor(mode: InteractiveMode) {
    this.trust = new TrustSelection(mode);
    this.fork = new ForkSelector(mode);
    this.tree = new TreeNavigation(mode);
    this.sessions = new SessionSelectors(mode);
    this.settings = new SettingsSelector(mode);
    this.settingsCallbacks = new SettingsCallbacks(mode);
    this.views = new ToolViews(mode);
  }
}
