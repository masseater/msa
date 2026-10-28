import type oauthTypesNs from "../../extensions/mcp/oauth.types.ts";
import type runtimeTypes from "../../extensions/mcp/runtime.types.ts";
import type MemoryServiceClass from "./memory-service.ts";
import type SepiaceClientClass from "./sepiace-client.ts";

declare namespace memoryTypes {
  interface ResolvedMemorySettings {
    readonly enabled: boolean;
    readonly recall: boolean;
  }

  interface MemoryConnectionOptions {
    readonly credentials?: oauthTypesNs.McpOAuthCredentialStore | undefined;
    readonly openUrl?: ((url: string) => void) | undefined;
  }

  interface SepiaceClientOptions {
    readonly agentDir: string;
    readonly cwd: string;
    readonly url: string;
    readonly credentials?: oauthTypesNs.McpOAuthCredentialStore | undefined;
    readonly onChange?: (() => void) | undefined;
  }

  type SepiaceState = "idle" | "connecting" | "connected" | "needs-auth" | "failed" | "closed";

  interface SepiaceReply {
    readonly text: string;
    readonly isError: boolean;
  }

  type SignInPrompt = oauthTypesNs.McpSignInPrompt;

  type CredentialStore = oauthTypesNs.McpOAuthCredentialStore;

  type McpConnection = runtimeTypes.McpServerConnection;

  type SepiaceClient = (typeof SepiaceClientClass)["prototype"];

  interface MemoryServiceOptions {
    readonly agentDir: string;
    readonly legacyDatabase: string;
    readonly cwd: string;
    readonly settings: () => ResolvedMemorySettings;
    readonly signInSaved: () => boolean;
    readonly client: SepiaceClient;
    readonly openUrl: (url: string) => void;
  }

  interface MigrationResult {
    readonly sent: number;
    readonly skipped: readonly { id: string; secrets: readonly string[] }[];
  }

  type MemoryConnection =
    | { readonly state: "ready" }
    | { readonly state: "missing" | "failing"; readonly detail: string };

  type MemoryService = (typeof MemoryServiceClass)["prototype"];

  interface MemoryCliOptions {
    readonly agentDir: string;
    readonly cwd: string;
    readonly connection?: MemoryConnectionOptions | undefined;
    readonly log?: ((line: string) => void) | undefined;
    readonly error?: ((line: string) => void) | undefined;
  }

  type MemoryCommand = { kind: "status" } | { kind: "request"; request: string };
}

export type { memoryTypes as default };
