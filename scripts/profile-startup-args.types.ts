import type ProfileErrorClass from "./profile-error.ts";

declare namespace profileStartupArgsTypes {
  type Mode = "rpc" | "tui";

  type Runtime = "bun" | "node";

  interface ProfileOptions {
    agentDir: string | undefined;
    build: boolean;
    bundle: boolean;
    cpuProfile: boolean;
    help: boolean;
    isolatedAgentDir: boolean;
    label: string | undefined;
    mode: Mode;
    offline: boolean;
    profileDir: string | undefined;
    runs: number;
    runtime: Runtime | "auto";
    warmup: number;
  }

  type ProfileError = ProfileErrorClass;
}

export type { profileStartupArgsTypes as default };
