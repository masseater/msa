import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import frontmatter from "../../utils/frontmatter.ts";
import type AgentSession from "../agent-session.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platform from "../platform/index.ts";
import slashCommands from "../slash-commands.ts";
import type slashCommandsTypes from "../slash-commands.types.ts";

const { slashCommandName, withSkillCommands } = slashCommands;
const { toErrorMessage } = errors;
const { readText } = platform.files;
const { stripFrontmatter } = frontmatter;

export default class SessionSlashCommands {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  isSkillCommand(text: string): boolean {
    const name = slashCommandName(text);
    return this.session.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }

  expandSkillCommand(text: string): Effect.Effect<string> {
    if (!text.startsWith("/")) return Effect.succeed(text);

    const spaceIndex = text.indexOf(" ");
    const skillName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

    const skill = this.session.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
    if (skill === undefined) return Effect.succeed(text);

    return Effect.promise(() =>
      readText(skill.filePath).then(
        (content) => {
          const body = stripFrontmatter(content).trim();
          const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
          return args === "" ? skillBlock : `${skillBlock}\n\n${args}`;
        },
        (err: unknown) => {
          this.session.extensions.binding.extensionRunnerInternal.emitError({
            error: toErrorMessage(err),
            event: "skill_expansion",
            extensionPath: skill.filePath,
          });
          return text;
        },
      ),
    );
  }

  slashCommandInfos(
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
    const templates: slashCommandsTypes.SlashCommandInfo[] = this.session.promptTemplates.map(
      (template) => ({
        description: template.description,
        name: template.name,
        source: "prompt",
        sourceInfo: template.sourceInfo,
      }),
    );
    const skills: slashCommandsTypes.SlashCommandInfo[] = this.session.resourceLoader
      .getSkills()
      .skills.map((skill) => ({
        description: skill.description,
        name: skill.name,
        source: "skill",
        sourceInfo: skill.sourceInfo,
      }));
    return withSkillCommands([...extensionCommands, ...templates], skills);
  }
}
