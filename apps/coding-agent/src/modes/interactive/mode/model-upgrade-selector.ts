import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import modelUpgrade from "../../../core/model-upgrade.ts";
import ModelUpgradeSelectorComponent from "../components/model-upgrade-selector.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { awaited, awaitingWith } = awaitingModule;
const {
  candidatesNamedByChanges,
  createUpgradeReplacements,
  findModelUpgrades,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} = modelUpgrade;

export default class ModelUpgradeSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showModelUpgradeSelector(): void {
    const candidates = findModelUpgrades(
      this.mode.session.models.selection.modelRuntime.getCatalogModels(),
    );
    const plan = planModelUpgrades({
      candidates,
      layers: {
        global: this.mode.settingsManager.getGlobalSettings(),
        project: this.mode.settingsManager.getProjectSettings(),
      },
    });
    const named = candidatesNamedByChanges(candidates, plan.changes);
    const shown = named.length > 0 ? named : candidates.filter((entry) => entry.confident);
    if (shown.length === 0) {
      this.mode.display.status.showStatus("No model upgrades found");
      return;
    }
    this.mode.editorSlot.showSelector((done) => {
      const component = new ModelUpgradeSelectorComponent(shown, {
        onApply: (candidate) =>
          Effect.runPromise(
            awaitingWith(function* () {
              const replacements = createUpgradeReplacements([candidate]);
              const written = this.mode.settingsManager.rewriteModelReferences((layer) =>
                rewriteModelReferencesInSettings(layer, replacements),
              );
              yield* awaited(this.mode.settingsManager.flush());
              const count = written.global.length + written.project.length;
              this.mode.footer.invalidate();
              return count === 0
                ? `${candidate.from.id} → ${candidate.to.id} · no setting names it`
                : `${candidate.from.id} → ${candidate.to.id} · ${count} setting${count === 1 ? "" : "s"}`;
            }, this),
          ),
        onCancel: () => {
          done();
          this.mode.ui.requestRender();
        },
        requestRender: () => this.mode.ui.requestRender(),
      });
      return { component, dispose: () => {}, focus: component };
    });
  }
}
