import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import InMemoryCodingAgentModelsStore from "../core/in-memory-coding-agent-models-store.ts";
import modelResolver from "../core/model-resolver.ts";
import ModelRuntime from "../core/model-runtime.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import type argsTypes from "./args.types.ts";
import type authCheckTypes from "./auth-check.types.ts";
import AuthCommandError from "./auth-command-error.ts";
import authCommand from "./auth-command.ts";

const { awaited, awaiting } = awaitingModule;
const { getAuthCredential, validateAuthCommandArgs } = authCommand;
const { resolveCliModel } = modelResolver;

function checkProviderAuthImpl(
  args: argsTypes.Args,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  options: { refresh: boolean } = { refresh: false },
): Promise<authCheckTypes.AuthCheckResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const { provider: cliProvider, model: cliModel } = validateAuthCommandArgs(args, "check");
      let provider = cliProvider;
      if (cliModel !== undefined && cliModel !== "") {
        const resolved = resolveCliModel({ cliModel, cliProvider, modelRuntime });
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
        return { provider, reason: "invalid_state", status: "invalid" };
      }
      if (modelRuntime.getProvider(provider) === undefined) {
        return { provider, reason: "provider_not_found", status: "not_ready" };
      }
      try {
        const auth = yield* awaited(modelRuntime.checkAuth(provider));
        if (auth === undefined)
          return { provider, reason: "credentials_not_configured", status: "not_ready" };
        if (options.refresh && (yield* awaited(modelRuntime.getAuth(provider))) === undefined) {
          return { provider, reason: "credentials_not_configured", status: "not_ready" };
        }
        return { authType: auth.type, provider, status: "ready" };
      } catch {
        return { provider, reason: "invalid_state", status: "invalid" };
      }
    }),
  );
}

const checkProviderAuth: {
  (
    args: argsTypes.Args,
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    options?: { refresh: boolean },
  ): Promise<authCheckTypes.AuthCheckResult>;
  (
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    options?: { refresh: boolean },
  ): (args: argsTypes.Args) => Promise<authCheckTypes.AuthCheckResult>;
} = dual((args: IArguments) => args.length >= 2, checkProviderAuthImpl);

function getProviderCredentialImpl(
  providerId: string,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  credentials: aiTypes.CredentialStore,
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

const getProviderCredential: {
  (
    providerId: string,
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    credentials: aiTypes.CredentialStore,
    options: { refresh: boolean },
  ): Promise<string | undefined>;
  (
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    credentials: aiTypes.CredentialStore,
    options: { refresh: boolean },
  ): (providerId: string) => Promise<string | undefined>;
} = dual((args: IArguments) => args.length >= 4, getProviderCredentialImpl);

function createAuthCheckModelRuntime(
  credentials: aiTypes.CredentialStore,
): Promise<modelRuntimeTypes.ModelRuntime> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials,
          modelsStore: new InMemoryCodingAgentModelsStore(),
          refreshOnCreate: false,
        }),
      );
    }),
  );
}

const authCheck = {
  checkProviderAuth,
  createAuthCheckModelRuntime,
  getProviderCredential,
};

export default authCheck;
