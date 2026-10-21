import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import errors from "../utils/errors.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import awaitingModule from "./awaiting.ts";
import platform from "./platform/index.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const { awaited, awaitingWith } = awaitingModule;
const { getAuthPath } = config;
const { normalizePath } = paths;
const { stripBom } = text;
const { toErrorMessage } = errors;
const { isCommandConfigValue, resolveConfigValue } = resolveConfigValueModule;
type AuthStorageData = Record<string, aiTypes.Credential>;
function validateAuthData(content: string): AuthStorageData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch (error) {
    throw new Error(`Failed to read auth.json: ${toErrorMessage(error)}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid auth.json: expected an object");
  }
  for (const [providerId, credential] of Object.entries(parsed)) {
    if (typeof credential !== "object" || credential === null || Array.isArray(credential)) {
      throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
    }
    const value = credential as Record<string, unknown>;
    if (value["type"] === "api_key") {
      const validKey = value["key"] === undefined || typeof value["key"] === "string";
      const validEnv =
        value["env"] === undefined ||
        (typeof value["env"] === "object" &&
          value["env"] !== null &&
          !Array.isArray(value["env"]) &&
          Object.values(value["env"]).every((entry) => typeof entry === "string"));
      if (validKey && validEnv) continue;
    } else if (
      value["type"] === "oauth" &&
      typeof value["access"] === "string" &&
      typeof value["refresh"] === "string" &&
      typeof value["expires"] === "number" &&
      Number.isFinite(value["expires"])
    ) {
      continue;
    }
    throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
  }

  return parsed as AuthStorageData;
}

const readAuthData = (authPath: string): Promise<AuthStorageData> =>
  platform.files.readText(authPath).then(validateAuthData, (error: unknown) => {
    if (platform.isMissingPath(error)) return {};
    throw new Error(`Failed to read auth.json: ${toErrorMessage(error)}`, { cause: error });
  });

const resolvedCredential = (
  credential: aiTypes.Credential | undefined,
): aiTypes.Credential | undefined => {
  if (credential === undefined) return undefined;
  if (
    credential.type !== "api_key" ||
    credential.key === undefined ||
    credential.key === "" ||
    isCommandConfigValue(credential.key)
  ) {
    return structuredClone(credential);
  }
  return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
};

export default class ReadOnlyAuthStorage implements aiTypes.CredentialStore {
  private readonly authPath: string;
  private data: Promise<AuthStorageData> | undefined;

  constructor(authPath: string = getAuthPath()) {
    this.authPath = normalizePath(authPath);
  }

  private load(): Promise<AuthStorageData> {
    this.data ??= readAuthData(this.authPath).catch((error: unknown) => {
      this.data = undefined;
      throw error;
    });
    return this.data;
  }

  read(
    providerId: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        const credential = (yield* awaited(this.load()))[providerId];
        options?.signal?.throwIfAborted();
        return resolvedCredential(credential);
      }, this),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        const credentials = Object.entries(yield* awaited(this.load())).map(
          ([providerId, credential]) => ({
            providerId,
            type: credential.type,
          }),
        );
        options?.signal?.throwIfAborted();
        return credentials;
      }, this),
    );
  }

  modify(
    _providerId: string,
    _fn: (current: aiTypes.Credential | undefined) => Promise<aiTypes.Credential | undefined>,
    _options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      Effect.sync(() => {
        throw new Error("Read-only credential storage cannot modify auth.json");
      }),
    );
  }

  delete(_providerId: string, _options?: aiTypes.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        throw new Error("Read-only credential storage cannot modify auth.json");
      }),
    );
  }
}
