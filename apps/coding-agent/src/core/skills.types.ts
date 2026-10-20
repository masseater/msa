import type diagnosticsTypes from "./diagnostics.ts";
import type sourceInfoTypes from "./source-info.types.ts";

declare namespace skillsTypes {
  interface SkillFrontmatter {
    name?: string;
    description?: string;
    "disable-model-invocation"?: boolean;
    [key: string]: unknown;
  }

  interface Skill {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    sourceInfo: sourceInfoTypes.SourceInfo;
    disableModelInvocation: boolean;
  }

  interface LoadSkillsResult {
    skills: Skill[];
    diagnostics: diagnosticsTypes.ResourceDiagnostic[];
  }

  interface LoadSkillsFromDirOptions {
    dir: string;
    source: string;
  }

  interface LoadSkillsOptions {
    cwd: string;
    agentDir: string;
    skillPaths: string[];
    includeDefaults: boolean;
  }
}

export type { skillsTypes as default };
