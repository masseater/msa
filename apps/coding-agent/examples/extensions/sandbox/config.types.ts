import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

declare namespace configTypes {
  interface SandboxConfig extends SandboxRuntimeConfig {
    enabled?: boolean;
  }
}

export type { configTypes as default };
