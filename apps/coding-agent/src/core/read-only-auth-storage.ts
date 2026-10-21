import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import errors from "../utils/errors.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import nodeFs from "./platform/node/fs.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const { readFileSync } = nodeFs;
const { getAuthPath } = config;
const { normalizePath } = paths;
const { stripBom } = text;
const { toErrorMessage } = errors;
const { isCommandConfigValue, resolveConfigValue } = resolveConfigValueModule;
type AuthStorageData = Record<string, aiTypes.Credential>;
export default class ReadOnlyAuthStorage implements aiTypes.CredentialStore {
  private readonly authPath: string;
  private data: AuthStorageData | undefined;

  constructor(authPath: string = getAuthPath()) {
    this.authPath = normalizePath(authPath);
  }

  private load(): AuthStorageData {
    if (this.data !== undefined) return this.data;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(readFileSync(this.authPath, "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.data = {};
        return this.data;
      }
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

    this.data = parsed as AuthStorageData;
    return this.data;
  }

  read(
    providerId: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        const credential = this.load()[providerId];
        options?.signal?.throwIfAborted();
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
      }),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        const credentials = Object.entries(this.load()).map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        }));
        options?.signal?.throwIfAborted();
        return credentials;
      }),
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
