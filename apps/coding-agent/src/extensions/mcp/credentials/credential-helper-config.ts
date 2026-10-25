import config from "../../../config.ts";
import platform from "../../../core/platform/index.ts";
import type secretStoresTypes from "./secret-stores.types.ts";

const { APP_NAME } = config;
const { join } = platform;
const { exists, readText } = platform.files;

type CredentialHelperConfig = secretStoresTypes.CredentialHelperConfig;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseCredentialHelper(value: unknown): CredentialHelperConfig | string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value["command"] !== "string" || value["command"] === "")
    return "credentialHelper must be an object with a command";
  const args: unknown = value["args"];
  if (args === undefined) return { command: value["command"] };
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
    return "credentialHelper.args must be an array of strings";
  return { args, command: value["command"] };
}

function credentialHelperError(value: unknown, scope: "global" | "project"): string | undefined {
  if (value === undefined) return undefined;
  if (scope === "project") return "credentialHelper is only allowed in the global mcp.json";
  const helper = parseCredentialHelper(value);
  return typeof helper === "string" ? helper : undefined;
}

function readCredentialHelper(agentDir: string): Promise<CredentialHelperConfig | undefined> {
  const path = join(agentDir, "mcp.json");
  return exists(path)
    .then((found) => (found ? readText(path) : undefined))
    .then((content) => {
      if (content === undefined) return undefined;
      const parsed: unknown = JSON.parse(content);
      const helper = isRecord(parsed)
        ? parseCredentialHelper(parsed["credentialHelper"])
        : undefined;
      if (typeof helper === "string") throw new Error(`${path}: ${helper}`);
      return helper;
    });
}

function memoryOnlyNotice(parts: {
  readonly reason: string;
  readonly deleted: { readonly path: string; readonly servers: readonly string[] } | undefined;
  readonly configPath: string;
}): string {
  const { deleted } = parts;
  return [
    `MCP sign-ins are not saved, because ${parts.reason}; they last until ${APP_NAME} exits.`,
    ...(deleted === undefined
      ? []
      : [
          `${deleted.path} was deleted so that its tokens are not left in a plain file.`,
          ...(deleted.servers.length === 0
            ? []
            : [
                `The sign-ins it held (${deleted.servers.join(", ")}) last only until ${APP_NAME} exits; sign in to them again after that.`,
              ]),
        ]),
    `To save sign-ins, set credentialHelper to a docker-credential helper in ${parts.configPath}, for example "credentialHelper": { "command": "docker-credential-pass" }.`,
  ].join("\n");
}

const credentialHelperConfig = { credentialHelperError, memoryOnlyNotice, readCredentialHelper };

export default credentialHelperConfig;
