import type skillsTypes from "./skills.types.ts";

declare namespace systemPromptTypes {
  interface BuildSystemPromptOptions {
    customPrompt?: string | undefined;
    forceSystemPrompt?: string | undefined;
    selectedTools?: string[] | undefined;
    hiddenTools?: string[] | undefined;
    toolSnippets?: Record<string, string> | undefined;
    toolGuidelines?: Record<string, string[]> | undefined;
    promptGuidelines?: string[] | undefined;
    appendSystemPrompt?: string | undefined;
    sections?: Record<string, string> | undefined;
    cwd: string;
    contextFiles?: Array<{ path: string; content: string }> | undefined;
    skills?: skillsTypes.Skill[] | undefined;
  }

  type NormalizedBuildSystemPromptOptions = BuildSystemPromptOptions & {
    selectedTools: string[];
    hiddenTools: string[];
    toolSnippets: Record<string, string>;
    toolGuidelines: Record<string, string[]>;
    promptGuidelines: string[];
    appendSystemPrompt: string;
    sections: Record<string, string>;
    contextFiles: Array<{ path: string; content: string }>;
    skills: skillsTypes.Skill[];
  };

  type SystemPromptSections = Record<string, string>;
}

export type { systemPromptTypes as default };
