import config from "../../../config.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import ProjectTrustStore from "../../../core/project-trust-store.ts";
import trustManager from "../../../core/trust-manager.ts";
import TrustSelectorComponent from "../components/trust-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { APP_NAME } = config;
const { getProjectTrustOptions } = trustManager;

export default class TrustSelection {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showTrustSelector(): Promise<void> {
    const cwd = this.mode.sessionManager.getCwd();
    const trustStore = new ProjectTrustStore(this.mode.runtimeHost.services.agentDir);
    return Promise.all([trustStore.getEntry(cwd), getProjectTrustOptions(cwd)]).then(
      ([savedDecision, trustOptions]) =>
        this.openTrustSelector({ cwd, savedDecision, trustOptions, trustStore }),
    );
  }

  private openTrustSelector(input: {
    readonly cwd: string;
    readonly savedDecision: Awaited<ReturnType<ProjectTrustStore["getEntry"]>>;
    readonly trustOptions: Awaited<ReturnType<typeof getProjectTrustOptions>>;
    readonly trustStore: ProjectTrustStore;
  }): void {
    const { cwd, savedDecision, trustOptions, trustStore } = input;
    this.mode.editorSlot.showSelector((done) => {
      const selector = new TrustSelectorComponent({
        cwd,
        onCancel: () => {
          done();
          this.mode.ui.requestRender();
        },
        onSelect: (selection) => {
          done();
          void trustStore.setMany(selection.updates).then(
            () =>
              this.mode.display.status.showStatus(
                `Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
              ),
            (error: unknown) =>
              this.mode.display.status.showError(
                `Could not save trust decision: ${error instanceof Error ? error.message : String(error)}`,
              ),
          );
        },
        projectTrusted: this.mode.settingsManager.isProjectTrusted(),
        savedDecision,
        trustOptions,
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
