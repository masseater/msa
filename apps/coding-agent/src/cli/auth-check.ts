import type { CredentialStore } from "@msa/ai";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../core/awaiting.ts";
import { resolveCliModel } from "../core/model-resolver.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../core/models-store.ts";
import type { Args } from "./args.ts";
import { AuthCommandError, getAuthCredential, validateAuthCommandArgs } from "./auth-command.ts";

export type AuthCheckStatus = "ready" | "not_ready" | "invalid";
export type AuthCheckReason =
  | "provider_not_found"
  | "credentials_not_configured"
  | "credential_not_available"
  | "invalid_state";

export interface AuthCheckResult {
  status: AuthCheckStatus;
  provider: string;
  reason?: AuthCheckReason;
  authType?: "api_key" | "oauth";
}

function checkProviderAuthImpl(
  args: Args,
  modelRuntime: ModelRuntime,
  options: { refresh: boolean } = { refresh: false },
): Promise<AuthCheckResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const { provider: cliProvider, model: cliModel } = validateAuthCommandArgs(args, "check");
      let provider = cliProvider;
      if (cliModel !== undefined && cliModel !== "") {
        const resolved = resolveCliModel({ cliProvider, cliModel, modelRuntime });
        if (
          (resolved.error !== undefined && resolved.error !== "") ||
          resolved.model === undefined
        ) {
          throw new AuthCommandError(resolved.error ?? `Unable to resolve model "${cliModel}"`);
        }
        provider = resolved.model.provider;
      }
      if (provider === undefined || provider === "")
        throw new AuthCommandError("Unable to resolve an auth provider");
      if (modelRuntime.getError() !== undefined) {
        return { status: "invalid", provider, reason: "invalid_state" };
      }
      if (modelRuntime.getProvider(provider) === undefined) {
        return { status: "not_ready", provider, reason: "provider_not_found" };
      }
      try {
        const auth = yield* awaited(modelRuntime.checkAuth(provider));
        if (auth === undefined)
          return { status: "not_ready", provider, reason: "credentials_not_configured" };
        if (options.refresh && (yield* awaited(modelRuntime.getAuth(provider))) === undefined) {
          return { status: "not_ready", provider, reason: "credentials_not_configured" };
        }
        return { status: "ready", provider, authType: auth.type };
      } catch {
        return { status: "invalid", provider, reason: "invalid_state" };
      }
    }),
  );
}

export const checkProviderAuth: {
  (
    args: Args,
    modelRuntime: ModelRuntime,
    options?: { refresh: boolean },
  ): Promise<AuthCheckResult>;
  (
    modelRuntime: ModelRuntime,
    options?: { refresh: boolean },
  ): (args: Args) => Promise<AuthCheckResult>;
} = dual((args: IArguments) => args.length >= 2, checkProviderAuthImpl);

function getProviderCredentialImpl(
  providerId: string,
  modelRuntime: ModelRuntime,
  credentials: CredentialStore,
  options: { refresh: boolean },
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      const credential = yield* awaited(credentials.read(providerId));
      if (!options.refresh && credential?.type === "oauth") return credential.access;
      return getAuthCredential(yield* awaited(modelRuntime.getAuth(providerId)));
    }),
  );
}

export const getProviderCredential: {
  (
    providerId: string,
    modelRuntime: ModelRuntime,
    credentials: CredentialStore,
    options: { refresh: boolean },
  ): Promise<string | undefined>;
  (
    modelRuntime: ModelRuntime,
    credentials: CredentialStore,
    options: { refresh: boolean },
  ): (providerId: string) => Promise<string | undefined>;
} = dual((args: IArguments) => args.length >= 4, getProviderCredentialImpl);

export function createAuthCheckModelRuntime(credentials: CredentialStore): Promise<ModelRuntime> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        ModelRuntime.create({
          credentials,
          modelsStore: new InMemoryCodingAgentModelsStore(),
          allowModelNetwork: false,
          refreshOnCreate: false,
        }),
      );
    }),
  );
}
