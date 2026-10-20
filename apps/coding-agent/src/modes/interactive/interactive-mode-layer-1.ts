import type tuiTypes from "@msa/tui/index.types";

import type footerDataProviderTypes from "../../core/footer-data-provider.types.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import type platformTypes from "../../core/platform.types.ts";
import type footerTypes from "./components/footer.types.ts";
import type statusIndicatorTypes from "./components/status-indicator.types.ts";
import statusIndicators from "./components/status-indicators.ts";
import InteractiveModeLayer0 from "./interactive-mode-layer-0.ts";
import type loginFlowTypes from "./login-flow.types.ts";
import OrchestratorPane from "./orchestrator-pane.ts";

const { IdleStatus } = statusIndicators;

export default abstract class InteractiveModeLayer1 extends InteractiveModeLayer0 {
  protected readonly orchestratorPane = new OrchestratorPane({
    columns: () => this.ui.terminal.columns,
    orchestrator: () => this.session.orchestrator,
    requestRender: () => this.ui.requestRender(),
    rows: () => Math.max(1, this.ui.terminal.rows),
    state: this.tasksViewState,
  });
  protected loginFlow!: loginFlowTypes.LoginFlow;
  protected footer!: footerTypes.FooterComponent;
  protected footerContainer!: tuiTypes.Container;
  protected footerDataProvider!: footerDataProviderTypes.FooterDataProvider;
  protected keybindings!: keybindingsTypes.KeybindingsManager;
  protected version!: string;
  protected isInitialized = false;
  protected onInputCallback?: ((text: string) => void) | undefined;
  protected goalTicker!: platformTypes.Scheduled | undefined;
  protected pendingUserInputs: string[] = [];
  protected activeStatusIndicator: statusIndicatorTypes.StatusIndicator | undefined = undefined;
  protected activeWorkingIndicatorEmbedded = false;
  protected readonly idleStatus = new IdleStatus();
  protected workingMessage: string | undefined = undefined;
  protected workingVisible = true;
}
