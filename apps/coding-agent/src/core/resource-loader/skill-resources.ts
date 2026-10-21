import awaitingModule from "../awaiting.ts";
import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import skillsModule from "../skills.ts";
import type skillsTypes from "../skills.types.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";

const { loadSkills } = skillsModule;
const { awaited } = awaitingModule;

const { createSourceInfo } = sourceInfoModule;

export default class SkillResources {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  additionalSkillPaths: string[] = [];

  noSkills = false;

  skillsOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["skillsOverride"];

  skills: skillsTypes.Skill[] = [];

  skillDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  lastSkillPaths: string[] = [];

  extensionSkillSourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();

  updateSkillsFromPaths(
    skillPaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<void> {
    const loaded: Promise<skillsTypes.LoadSkillsResult> =
      this.noSkills && skillPaths.length === 0
        ? Promise.resolve({ diagnostics: [], skills: [] })
        : loadSkills({
            agentDir: this.owner.environment.agentDir,
            cwd: this.owner.environment.cwd,
            includeDefaults: false,
            skillPaths,
          });
    return loaded
      .then((skillsResult) =>
        this.skillsOverride === undefined ? skillsResult : this.skillsOverride(skillsResult),
      )
      .then((resolvedSkills) =>
        Promise.all(
          resolvedSkills.skills.map((skill) => this.withSourceInfo(skill, metadataByPath)),
        ).then((skills) => {
          this.skills = skills;
          this.skillDiagnostics = resolvedSkills.diagnostics;
          return undefined;
        }),
      );
  }

  private withSourceInfo(
    skill: skillsTypes.Skill,
    metadataByPath: Map<string, packageManagerTypes.PathMetadata> | undefined,
  ): Promise<skillsTypes.Skill> {
    const { paths } = this.owner.environment;
    const sourceInfo =
      paths.findSourceInfoForPath(skill.filePath, this.extensionSkillSourceInfos, metadataByPath) ??
      skill.sourceInfo;
    return (
      sourceInfo === undefined
        ? paths.getDefaultSourceInfoForPath(skill.filePath)
        : Promise.resolve(sourceInfo)
    ).then((resolved) => ({ ...skill, sourceInfo: resolved }));
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalSkillPaths = options.additionalSkillPaths ?? [];
    this.noSkills = options.noSkills ?? false;
    this.skillsOverride = options.skillsOverride;
  }

  *reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan) {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.skills;
    const skillPaths = yield* awaited(
      this.noSkills
        ? paths.mergePaths(cli, this.additionalSkillPaths)
        : paths.mergePaths([...cli, ...configured], this.additionalSkillPaths),
    );
    this.lastSkillPaths = skillPaths;
    yield* awaited(this.updateSkillsFromPaths(skillPaths, plan.metadataByPath));
    for (const resolved of yield* awaited(paths.missingPaths(this.additionalSkillPaths, true))) {
      if (this.skillDiagnostics.some((d) => d.path === resolved)) continue;
      this.skillDiagnostics.push({
        message: "Skill path does not exist",
        path: resolved,
        type: "error",
      });
    }
  }

  *extend(entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>) {
    for (const entry of entries) {
      this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    if (entries.length === 0) return;
    this.lastSkillPaths = yield* awaited(
      this.owner.environment.paths.mergePaths(
        this.lastSkillPaths,
        entries.map((entry) => entry.path),
      ),
    );
    yield* awaited(
      this.updateSkillsFromPaths(
        this.lastSkillPaths,
        this.owner.environment.paths.resourceMetadataByPath,
      ),
    );
  }
}
