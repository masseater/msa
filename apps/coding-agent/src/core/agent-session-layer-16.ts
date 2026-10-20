import ai from "@msa/ai";

import type agentSessionInternalTypes from "./agent-session-internal.types.ts";
import AgentSessionLayer15 from "./agent-session-layer-15.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";
import slashCommands from "./slash-commands.ts";
import type slashCommandsTypes from "./slash-commands.types.ts";

const { withSkillCommands } = slashCommands;
const { contentText } = ai;

export default abstract class AgentSessionLayer16 extends AgentSessionLayer15 {
  protected slashCommandInfos(
    runner: extensionsTypes.ExtensionRunner,
  ): slashCommandsTypes.SlashCommandInfo[] {
    const extensionCommands: slashCommandsTypes.SlashCommandInfo[] = runner
      .getRegisteredCommands()
      .map((command) => ({
        description: command.description,
        name: command.invocationName,
        source: "extension",
        sourceInfo: command.sourceInfo,
      }));
    const templates: slashCommandsTypes.SlashCommandInfo[] = this.promptTemplates.map(
      (template) => ({
        description: template.description,
        name: template.name,
        source: "prompt",
        sourceInfo: template.sourceInfo,
      }),
    );
    const skills: slashCommandsTypes.SlashCommandInfo[] = this.resourceLoaderInternal
      .getSkills()
      .skills.map((skill) => ({
        description: skill.description,
        name: skill.name,
        source: "skill",
        sourceInfo: skill.sourceInfo,
      }));
    return withSkillCommands([...extensionCommands, ...templates], skills);
  }

  protected moveToTreeTarget(
    targetEntry: sessionManagerTypes.SessionEntry,
    summary: agentSessionInternalTypes.TreeSummary,
    label: string | undefined,
  ) {
    let newLeafId: string | null = targetEntry.id;
    let editorText: string | undefined;
    if (targetEntry.type === "message" && targetEntry.message.role === "user") {
      newLeafId = targetEntry.parentId;
      editorText = contentText(targetEntry.message.content, "");
    } else if (targetEntry.type === "custom_message") {
      newLeafId = targetEntry.parentId;
      editorText = contentText(targetEntry.content, "");
    }
    const hasLabel = label !== undefined && label !== "";
    if (summary.text === undefined || summary.text === "") {
      if (newLeafId === null) this.sessionManager.resetLeaf();
      else this.sessionManager.branch(newLeafId);
      if (hasLabel) this.sessionManager.appendLabelChange(targetEntry.id, label);
      return { editorText, summaryEntry: undefined };
    }
    const summaryId = this.sessionManager.branchWithSummary(
      newLeafId,
      summary.text,
      summary.details,
      summary.fromExtension,
      summary.usage,
    );
    const summaryEntry = this.sessionManager.getEntry(
      summaryId,
    ) as sessionManagerTypes.BranchSummaryEntry;
    if (hasLabel) this.sessionManager.appendLabelChange(summaryId, label);
    return { editorText, summaryEntry };
  }
}
