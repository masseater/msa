import type hostTypesModule from "./host-types.types.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import type reloadModule from "./reload.ts";

declare namespace reloadTypes {
  interface ReloadRequest {
    readonly plugins: readonly hostTypesModule.PluginRef[];
    readonly options: reloadCandidateTypes.ReloadOptions;
    readonly codeVersion?: number | undefined;
  }

  type ReloadOptions = reloadCandidateTypes.ReloadOptions;

  type ReloadReport = reloadCandidateTypes.ReloadReport;

  type Reload = (typeof reloadModule.Reload)["prototype"];
}

export type { reloadTypes as default };
