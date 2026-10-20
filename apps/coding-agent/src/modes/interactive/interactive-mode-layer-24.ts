import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import modelUpgrade from "../../core/model-upgrade.ts";
import AssistantMessageComponent from "./components/assistant-message.ts";
import BranchSummaryMessageComponent from "./components/branch-summary-message.ts";
import CompactionSummaryMessageComponent from "./components/compaction-summary-message.ts";
import ModelUpgradeSelectorComponent from "./components/model-upgrade-selector.ts";
import InteractiveModeLayer23 from "./interactive-mode-layer-23.ts";

const {
  candidatesNamedByChanges,
  createUpgradeReplacements,
  findModelUpgrades,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} = modelUpgrade;
const { awaited, awaitingWith } = awaitingModule;

export default abstract class InteractiveModeLayer24 extends InteractiveModeLayer23 {
  protected onMessageStart(message: agentTypes.AgentMessage): void {
    if (message.role === "custom" || message.role === "user") {
      this.addMessageToChat(message);
      if (message.role === "user") this.updatePendingMessagesDisplay();
      this.ui.requestRender();
      return;
    }
    if (message.role !== "assistant") return;
    this.streamingComponent = new AssistantMessageComponent(
      undefined,
      this.hideThinkingBlock,
      this.getMarkdownThemeWithSettings(),
      this.hiddenThinkingLabel,
      this.outputPad,
      this.getMarkdownTransformers(),
    );
    this.streamingMessage = message;
    this.chatContainer.addChild(this.streamingComponent);
    this.streamingComponent.updateContent(this.streamingMessage, true);
    this.ui.requestRender();
  }

  protected addMessageToChat(
    message: agentTypes.AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    const markdown = () => this.getMarkdownThemeWithSettings();
    switch (message.role) {
      case "bashExecution":
        return this.addBashExecutionToChat(message);
      case "custom":
        return this.addCustomMessageToChat(message);
      case "compactionSummary":
        return this.addSummaryToChat(
          new CompactionSummaryMessageComponent(message, markdown(), this.outputPad),
        );
      case "branchSummary":
        return this.addSummaryToChat(
          new BranchSummaryMessageComponent(message, markdown(), this.outputPad),
        );
      case "user":
        return this.addUserMessageToChat(message, options);
      case "assistant":
        return this.chatContainer.addChild(
          new AssistantMessageComponent(
            message,
            this.hideThinkingBlock,
            markdown(),
            this.hiddenThinkingLabel,
            this.outputPad,
            this.getMarkdownTransformers(),
          ),
        );
      case "system":
      case "toolResult":
        return undefined;
      default:
        message satisfies never;
    }
  }

  protected showModelUpgradeSelector(): void {
    const candidates = findModelUpgrades(
      this.session.models.selection.modelRuntime.getCatalogModels(),
    );
    const plan = planModelUpgrades({
      candidates,
      layers: {
        global: this.settingsManager.getGlobalSettings(),
        project: this.settingsManager.getProjectSettings(),
      },
    });
    const named = candidatesNamedByChanges(candidates, plan.changes);
    const shown = named.length > 0 ? named : candidates.filter((entry) => entry.confident);
    if (shown.length === 0) {
      this.showStatus("No model upgrades found");
      return;
    }
    this.editorSlot.showSelector((done) => {
      const component = new ModelUpgradeSelectorComponent(shown, {
        onApply: (candidate) =>
          Effect.runPromise(
            awaitingWith(function* () {
              const replacements = createUpgradeReplacements([candidate]);
              const written = this.settingsManager.rewriteModelReferences((layer) =>
                rewriteModelReferencesInSettings(layer, replacements),
              );
              yield* awaited(this.settingsManager.flush());
              const count = written.global.length + written.project.length;
              this.footer.invalidate();
              return count === 0
                ? `${candidate.from.id} → ${candidate.to.id} · no setting names it`
                : `${candidate.from.id} → ${candidate.to.id} · ${count} setting${count === 1 ? "" : "s"}`;
            }, this),
          ),
        onCancel: () => {
          done();
          this.ui.requestRender();
        },
        requestRender: () => this.ui.requestRender(),
      });
      return { component, dispose: () => {}, focus: component };
    });
  }
}
