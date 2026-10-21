import type InteractiveMode from "../interactive-mode.ts";
import ModeLogin from "./login.ts";
import ModelSelector from "./model-selector.ts";
import ModelUpgradeSelector from "./model-upgrade-selector.ts";
import ScopedModelState from "./scoped-model-state.ts";
import ScopedModelsSelector from "./scoped-models-selector.ts";
import ThinkingSelector from "./thinking-selector.ts";

export default class ModeModels {
  readonly upgrade: ModelUpgradeSelector;
  readonly scopedState: ScopedModelState;
  readonly selector: ModelSelector;
  readonly scoped: ScopedModelsSelector;
  readonly thinking: ThinkingSelector;
  readonly login: ModeLogin;

  constructor(mode: InteractiveMode) {
    this.upgrade = new ModelUpgradeSelector(mode);
    this.scopedState = new ScopedModelState(mode);
    this.selector = new ModelSelector(mode);
    this.scoped = new ScopedModelsSelector(mode);
    this.thinking = new ThinkingSelector(mode);
    this.login = new ModeLogin(mode);
  }
}
