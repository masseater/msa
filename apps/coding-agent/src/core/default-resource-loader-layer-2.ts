import config from "../config.ts";
import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import DefaultResourceLoaderLayer1 from "./default-resource-loader-layer-1.ts";
import DefaultResourceLoader from "./default-resource-loader.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type skillsTypes from "./skills.types.ts";

const { existsSync, statSync } = nodeFs;
const { join, resolve, sep } = platformNode;
const { CONFIG_DIR_NAME } = config;

export default abstract class DefaultResourceLoaderLayer2 extends DefaultResourceLoaderLayer1 {
  fork(): DefaultResourceLoader {
    return new DefaultResourceLoader(this.options);
  }

  getExtensions(): extensionsTypesTypes.LoadExtensionsResult {
    return this.extensionsResult;
  }

  getSkills(): { skills: skillsTypes.Skill[]; diagnostics: diagnosticsTypes.ResourceDiagnostic[] } {
    return { diagnostics: this.skillDiagnostics, skills: this.skills };
  }

  getPrompts(): {
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  } {
    return { diagnostics: this.promptDiagnostics, prompts: this.prompts };
  }

  getThemes(): { themes: themeTypes.Theme[]; diagnostics: diagnosticsTypes.ResourceDiagnostic[] } {
    return { diagnostics: this.themeDiagnostics, themes: this.themes };
  }

  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
    return { agentsFiles: this.agentsFiles };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  getSystemPromptSource(): { path: string } | undefined {
    return this.systemPromptSourcePath !== undefined && this.systemPromptSourcePath !== ""
      ? { path: this.systemPromptSourcePath }
      : undefined;
  }

  getAppendSystemPrompt(): string[] {
    return this.appendSystemPrompt;
  }

  getAppendSystemPromptSources(): Array<{ path: string }> {
    return this.appendSystemPromptSourcePaths.map((path) => ({ path }));
  }

  protected addExtensionConflictDiagnostics(
    extensionsResult: extensionsTypesTypes.LoadExtensionsResult,
  ): void {
    const conflicts = this.detectExtensionConflicts(extensionsResult.extensions);
    for (const conflict of conflicts) {
      extensionsResult.errors.push({ error: conflict.message, path: conflict.path });
    }
  }

  protected mapSkillPath(
    resource: packageManagerTypes.ResolvedResource,
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
  ): string {
    if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
      return resource.path;
    }
    try {
      const stats = statSync(resource.path);
      if (!stats.isDirectory()) {
        return resource.path;
      }
    } catch {
      return resource.path;
    }
    const skillFile = join(resource.path, "SKILL.md");
    if (existsSync(skillFile)) {
      if (!metadataByPath.has(skillFile)) {
        metadataByPath.set(skillFile, resource.metadata);
      }
      return skillFile;
    }
    return resource.path;
  }

  protected getDefaultSourceInfoForPathPart1(filePath: string) {
    const normalizedPath = resolve(filePath);
    const agentRoots = [
      join(this.agentDir, "skills"),
      join(this.agentDir, "prompts"),
      join(this.agentDir, "themes"),
      join(this.agentDir, "extensions"),
    ];
    const projectRoots = [
      join(this.cwd, CONFIG_DIR_NAME, "skills"),
      join(this.cwd, CONFIG_DIR_NAME, "prompts"),
      join(this.cwd, CONFIG_DIR_NAME, "themes"),
      join(this.cwd, CONFIG_DIR_NAME, "extensions"),
    ];
    return { agentRoots, normalizedPath, projectRoots };
  }

  protected dedupePrompts(prompts: promptTemplatesTypes.PromptTemplate[]): {
    prompts: promptTemplatesTypes.PromptTemplate[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  } {
    const seen = new Map<string, promptTemplatesTypes.PromptTemplate>();
    const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

    for (const prompt of prompts) {
      const existing = seen.get(prompt.name);
      if (existing === undefined) {
        seen.set(prompt.name, prompt);
      } else {
        diagnostics.push({
          collision: {
            loserPath: prompt.filePath,
            name: prompt.name,
            resourceType: "prompt",
            winnerPath: existing.filePath,
          },
          message: `name "/${prompt.name}" collision`,
          path: prompt.filePath,
          type: "collision",
        });
      }
    }

    return { diagnostics, prompts: Array.from(seen.values()) };
  }

  protected dedupeThemes(themes: themeTypes.Theme[]): {
    themes: themeTypes.Theme[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  } {
    const seen = new Map<string, themeTypes.Theme>();
    const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

    for (const t of themes) {
      const name = t.name ?? "unnamed";
      const existing = seen.get(name);
      if (existing === undefined) {
        seen.set(name, t);
      } else {
        diagnostics.push({
          collision: {
            loserPath: t.sourcePath ?? "<builtin>",
            name,
            resourceType: "theme",
            winnerPath: existing.sourcePath ?? "<builtin>",
          },
          message: `name "${name}" collision`,
          path: t.sourcePath,
          type: "collision",
        });
      }
    }

    return { diagnostics, themes: Array.from(seen.values()) };
  }

  protected discoverSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
    if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.agentDir, "SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  protected discoverAppendSystemPromptFile(): string | undefined {
    const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
    if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
      return projectPath;
    }

    const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
    if (existsSync(globalPath)) {
      return globalPath;
    }

    return undefined;
  }

  protected isUnderPath(target: string, root: string): boolean {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  }

  protected detectExtensionConflicts(
    extensions: extensionsTypesTypes.Extension[],
  ): Array<{ path: string; message: string }> {
    const conflicts: Array<{ path: string; message: string }> = [];

    const toolOwners = new Map<string, string>();
    const flagOwners = new Map<string, string>();

    for (const ext of extensions) {
      for (const toolName of ext.tools.keys()) {
        const existingOwner = toolOwners.get(toolName);
        if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
          conflicts.push({
            message: `Tool "${toolName}" conflicts with ${existingOwner}`,
            path: ext.path,
          });
        } else {
          toolOwners.set(toolName, ext.path);
        }
      }

      for (const flagName of ext.flags.keys()) {
        const existingOwner = flagOwners.get(flagName);
        if (existingOwner !== undefined && existingOwner !== "" && existingOwner !== ext.path) {
          conflicts.push({
            message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
            path: ext.path,
          });
        } else {
          flagOwners.set(flagName, ext.path);
        }
      }
    }

    return conflicts;
  }
}
