import type ModelRuntime from "../model-runtime.ts";
import type sdkTypes from "../sdk.types.ts";
import type SessionManager from "../session-manager.ts";
import type SettingsManager from "../settings-manager.ts";

declare namespace sdkInternalTypes {
  interface SdkRuntime {
    agentDir: string;
    cwd: string;
    modelRuntime: ModelRuntime;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    options: sdkTypes.CreateAgentSessionOptions;
  }

  type Options = sdkTypes.CreateAgentSessionOptions;

  type CreateAgentSession = (options: Options) => Promise<sdkTypes.CreateAgentSessionResult>;
}

export type { sdkInternalTypes as default };
