import type InteractiveMode from "../interactive-mode.ts";
import LoginFlow from "../login-flow.ts";
import type loginFlowTypes from "../login-flow.types.ts";

export default class ModeLogin {
  loginFlow!: loginFlowTypes.LoginFlow;

  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  start(): void {
    const { mode } = this;
    this.loginFlow = new LoginFlow({
      editorSlot: mode.editorSlot,
      programStatus: mode.layout.programStatus,
      refreshAuthState: () => {
        mode.models.selector.updateAvailableProviderCount();
        mode.footer.invalidate();
        mode.input.keys.updateEditorBorderColor();
      },
      get session() {
        return mode.session;
      },
      showError: (message) => mode.display.status.showError(message),
      showStatus: (message) => mode.display.status.showStatus(message),
      showWarning: (message) => mode.display.status.showWarning(message),
      ui: mode.ui,
    });
  }
}
