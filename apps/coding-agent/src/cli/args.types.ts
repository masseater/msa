import type agentTypes from "@msa/agent-core/index.types";

import type settingsManagerTypes from "../core/settings-manager.types.ts";

declare namespace argsTypes {
  type Mode = "text" | "json" | "rpc";

  interface Args {
    provider?: string;
    model?: string;
    apiKey?: string;
    systemPrompt?: string;
    appendSystemPrompt?: string[];
    thinking?: agentTypes.ThinkingLevel;
    continue?: boolean;
    resume?: boolean;
    help?: boolean;
    version?: boolean;
    mode?: Mode;
    name?: string;
    noSession?: boolean;
    session?: string;
    sessionId?: string;
    fork?: string;
    sessionDir?: string;
    models?: string[];
    tools?: string[];
    excludeTools?: string[];
    noTools?: boolean;
    noBuiltinTools?: boolean;
    extensions?: string[];
    noExtensions?: boolean;
    noMcp?: boolean;
    print?: boolean;
    export?: string;
    noSkills?: boolean;
    skills?: string[];
    promptTemplates?: string[];
    noPromptTemplates?: boolean;
    themes?: string[];
    useTheme?: string;
    noThemes?: boolean;
    noContextFiles?: boolean;
    listModels?: string | true;
    offline?: boolean;
    tuiMode?: settingsManagerTypes.TuiMode;
    verbose?: boolean;
    projectTrustOverride?: boolean;
    messages: string[];
    fileArgs: string[];

    unknownFlags: Map<string, boolean | string>;
    diagnostics: Array<{ type: "warning" | "error"; message: string }>;
  }
}

export type { argsTypes as default };
