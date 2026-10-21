import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import cliModelFlag from "../core/cli-model.ts";
import modelResolver from "../core/model-resolver.ts";
import type ModelRuntime from "../core/model-runtime.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import type argsTypes from "./args.types.ts";
import AuthCommandError from "./auth-command-error.ts";
import authCommand from "./auth-command.ts";
import type authCommandTypes from "./auth-command.types.ts";

const { getAuthCredential, validateAuthCommandArgs } = authCommand;
const { awaited, awaiting } = awaitingModule;
const { resolveCliModel } = cliModelFlag;
const { resolveModelReference } = modelResolver;

const DEFAULT_BEARER_TOKEN_MIN_EXPIRY_MS = 30 * 60_000;

type CredentialPrintKind = Exclude<authCommandTypes.AuthCommandKind, "check">;

function resolveCredentialForPrintImpl(
  args: argsTypes.Args,
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  kind: CredentialPrintKind,
  minExpiryMs?: number,
  signal?: AbortSignal,
): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const { provider: cliProvider, model: cliModel } = validateAuthCommandArgs(args, kind);
      const credentialTypes = new Map<string, aiTypes.CredentialInfo["type"]>(
        (yield* awaited(modelRuntime.listCredentials(signal === undefined ? {} : { signal }))).map(
          (credential) => [credential.providerId, credential.type],
        ),
      );
      const providers: Array<{ id: string; model?: aiTypes.Model<aiTypes.Api> }> = [];
      if (cliProvider !== undefined && cliProvider !== "") {
        const provider = modelRuntime.getProvider(cliProvider);
        if (provider === undefined) {
          throw new AuthCommandError(
            `Unknown provider "${cliProvider}". Use --list-models to see available providers.`,
          );
        }
        if (cliModel !== undefined && cliModel !== "") {
          const resolved = resolveCliModel({ cliModel, cliProvider: provider.id, modelRuntime });
          if (
            (resolved.error !== undefined && resolved.error !== "") ||
            resolved.model === undefined
          ) {
            throw new AuthCommandError(
              resolved.error ?? "Unable to resolve the requested provider/model",
            );
          }
          providers.push({ id: provider.id, model: resolved.model });
        } else {
          providers.push({ id: provider.id });
        }
      } else {
        const models = modelRuntime.getModels();
        for (const provider of modelRuntime.getProviders()) {
          if (!credentialTypes.has(provider.id)) continue;
          const resolved = resolveModelReference(
            { fuzzy: true, provider: provider.id, text: cliModel!, thinkingSuffix: "strict" },
            models,
            () => true,
          );
          if (resolved.status === "resolved")
            providers.push({ id: provider.id, model: resolved.model });
        }
        if (providers.length === 0) {
          throw new AuthCommandError(
            `Model "${cliModel}" not found. Use --list-models to see available models.`,
          );
        }
      }

      const credentials: Array<{ providerId: string; value: string }> = [];
      yield* resolveCredentialForPrintImplPart2(
        providers,
        credentialTypes,
        kind,
        minExpiryMs,
        signal,
        modelRuntime,
        credentials,
      );

      const [onlyCredential] = credentials;
      if (credentials.length === 1 && onlyCredential !== undefined) return onlyCredential.value;
      resolveCredentialForPrintImplPart1(
        credentials,
        providers,
        credentialTypes,
        cliProvider,
        kind,
      );
      throw new AuthCommandError(
        `Multiple configured providers matched (${credentials.map(({ providerId }) => providerId).join(", ")}). Specify --provider.`,
      );
    }),
  );
}

const resolveCredentialForPrint: {
  (
    args: argsTypes.Args,
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    kind: CredentialPrintKind,
    minExpiryMs?: number,
    signal?: AbortSignal,
  ): Promise<string>;
  (
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    kind: CredentialPrintKind,
    minExpiryMs?: number,
    signal?: AbortSignal,
  ): (args: argsTypes.Args) => Promise<string>;
} = dual((args: IArguments) => args.length >= 3, resolveCredentialForPrintImpl);

const credentialPrint = {
  resolveCredentialForPrint,
};

export default credentialPrint;

function* resolveCredentialForPrintImplPart2(
  providers: { id: string; model?: aiTypes.Model<aiTypes.Api> }[],
  credentialTypes: Map<string, "api_key" | "oauth">,
  kind: string,
  minExpiryMs: number | undefined,
  signal: AbortSignal | undefined,
  modelRuntime: ModelRuntime,
  credentials: { providerId: string; value: string }[],
) {
  for (const provider of providers) {
    const type = credentialTypes.get(provider.id);
    if (kind === "api_key" && type === "oauth") continue;
    if (kind === "bearer_token" && type !== "oauth") continue;
    const authOptions = {
      ...(kind === "bearer_token"
        ? { minOAuthValidityMs: minExpiryMs ?? DEFAULT_BEARER_TOKEN_MIN_EXPIRY_MS }
        : {}),
      ...(signal === undefined ? {} : { signal }),
    };
    const auth =
      provider.model === undefined
        ? yield* awaited(modelRuntime.getAuth(provider.id, authOptions))
        : yield* awaited(modelRuntime.getAuth(provider.model, authOptions));
    const value = getAuthCredential(auth);
    if (value !== undefined && value !== "") credentials.push({ providerId: provider.id, value });
  }
}

function resolveCredentialForPrintImplPart1(
  credentials: { providerId: string; value: string }[],
  providers: { id: string; model?: aiTypes.Model<aiTypes.Api> }[],
  credentialTypes: Map<string, "api_key" | "oauth">,
  cliProvider: string | undefined,
  kind: string,
) {
  if (credentials.length === 0) {
    const providerId = providers[0]?.id;
    const type =
      providerId !== undefined && providerId !== "" ? credentialTypes.get(providerId) : undefined;
    if (cliProvider !== undefined && cliProvider !== "" && kind === "api_key" && type === "oauth") {
      throw new AuthCommandError(
        `Provider "${providerId}" is configured with OAuth, not an API key`,
      );
    }
    if (
      cliProvider !== undefined &&
      cliProvider !== "" &&
      kind === "bearer_token" &&
      type !== "oauth"
    ) {
      throw new AuthCommandError(
        `Provider "${providerId}" is not configured with an OAuth bearer token`,
      );
    }
    throw new AuthCommandError(
      `No usable ${kind === "api_key" ? "API key" : "OAuth bearer token"} is configured`,
    );
  }
}
