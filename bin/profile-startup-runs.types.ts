import type hostTypes from "./host.types.ts";
import type profileStartupArgsTypes from "./profile-startup-args.types.ts";

declare namespace profileStartupRunsTypes {
  interface Paths {
    readonly bundledDistCli: string;
    readonly distCli: string;
    readonly packageDir: string;
    readonly repoRoot: string;
    readonly srcCli: string;
  }

  interface RunParams {
    readonly host: hostTypes.HostShape;
    readonly measuredIndex: number | undefined;
    readonly options: profileStartupArgsTypes.ProfileOptions & { readonly label: string };
    readonly paths: Paths;
    readonly profileDir: string;
    readonly runIndex: number;
    readonly runtime: profileStartupArgsTypes.Runtime;
  }
}

export type { profileStartupRunsTypes as default };
