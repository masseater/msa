import config from "../../../config.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import ProjectTrustStore from "../../../core/project-trust-store.ts";
import TrustSelectorComponent from "../components/trust-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { APP_NAME } = config;

export default class TrustSelection {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showTrustSelector(): void {
    const cwd = this.mode.sessionManager.getCwd();
    const trustStore = new ProjectTrustStore(this.mode.runtimeHost.services.agentDir);
    const savedDecision = trustStore.getEntry(cwd);
    this.mode.editorSlot.showSelector((done) => {
      const selector = new TrustSelectorComponent({
        cwd,
        onCancel: () => {
          done();
          this.mode.ui.requestRender();
        },
        onSelect: (selection) => {
          trustStore.setMany(selection.updates);
          done();
          this.mode.display.status.showStatus(
            `Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
          );
        },
        projectTrusted: this.mode.settingsManager.isProjectTrusted(),
        savedDecision,
      });
      return { component: selector, focus: selector };
    });
  }

  createProjectTrustContext(cwd: string): extensionsTypes.ProjectTrustContext {
    const ui = this.mode.extensions.ui.createExtensionUIContext();
    return {
      cwd,
      hasUI: true,
      mode: "tui",
      ui: {
        confirm: ui.confirm,
        input: ui.input,
        notify: ui.notify,
        select: ui.select,
      },
    };
  }
}
