import type runSshTypes from "./run-ssh.types.ts";
import type setupErrorTypes from "./setup-error.types.ts";

declare namespace detectTypes {
  type RemotePlatform = {
    platform: "linux" | "android" | "darwin" | "windows";
    arch: "x64" | "arm64";
    home: string;
    shell?: "cmd" | "powershell";
    warnings: string[];
  };

  type DetectFailure = runSshTypes.SshFailure | setupErrorTypes.SetupError;

  type SetupError = setupErrorTypes.SetupError;
}

export type { detectTypes as default };
