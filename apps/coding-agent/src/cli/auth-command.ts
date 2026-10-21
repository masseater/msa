import type aiTypes from "@msa/ai/index.types";
import { dual } from "effect/Function";

import config from "../config.ts";
import platform from "../core/platform/index.ts";
import type argsTypes from "./args.types.ts";
import AuthCommandError from "./auth-command-error.ts";
import type authCommandTypes from "./auth-command.types.ts";

const { APP_NAME } = config;
const { writeLog } = platform;

const AUTH_COMMAND_USAGE: Record<authCommandTypes.AuthCommandKind, string> = {
  api_key: `${APP_NAME} auth print-api-key --provider <provider> [--model <model>]`,
  bearer_token: `${APP_NAME} auth print-bearer-token --provider <provider> [--model <model>] [--min-expiry <duration>]`,
  check: `${APP_NAME} auth check --provider <provider> [--json] [--credentials] [--no-refresh]`,
};
function getAuthCommandName(kind: authCommandTypes.AuthCommandKind): string {
  return kind === "check"
    ? "auth check"
    : kind === "api_key"
      ? "auth print-api-key"
      : "auth print-bearer-token";
}
function getAuthCommandUsage(kind: authCommandTypes.AuthCommandKind): string {
  return AUTH_COMMAND_USAGE[kind];
}
function isAuthCommandHelp(args: string[]): boolean {
  return (
    args[0] === "auth" &&
    (args[1] === undefined || args[1] === "help" || args.includes("--help") || args.includes("-h"))
  );
}
function printAuthCommandHelp(): void {
  writeLog(`Usage:
  msa auth print-api-key [--provider <provider>] [--model <model>]
  msa auth print-bearer-token [--provider <provider>] [--model <model>] [--min-expiry <duration>]
  msa auth check [--provider <provider>] [--model <model>] [--json] [--credentials] [--no-refresh]

Auth commands require at least one of --provider or --model. Checks refresh expired OAuth credentials by default; --no-refresh prevents this. --credentials emits the credential, or includes it in JSON output.`);
}
function parseAuthCommand(args: string[]): authCommandTypes.AuthCommand | undefined {
  if (args[0] !== "auth") return undefined;

  const kind =
    args[1] === "check"
      ? "check"
      : args[1] === "print-api-key"
        ? "api_key"
        : args[1] === "print-bearer-token"
          ? "bearer_token"
          : undefined;
  if (kind === undefined) {
    throw new AuthCommandError(
      `Unknown auth command "${args[1] ?? ""}". Use "${APP_NAME} auth print-api-key", "${APP_NAME} auth print-bearer-token", or "${APP_NAME} auth check".`,
    );
  }

  const parsed = parseAuthCommandOptions(args, kind);
  return parsed.minExpiryMs === undefined
    ? { kind, ...parsed.flags }
    : { kind, ...parsed.flags, minExpiryMs: parsed.minExpiryMs };
}
interface AuthCommandFlags {
  args: string[];
  json: boolean;
  credentials: boolean;
  noRefresh: boolean;
}
function parseMinExpiryMs(value: string | undefined): number {
  const match = value !== undefined && value !== "" ? /^(\d+)(ms|s|m|h)$/iu.exec(value) : null;
  if (match === null)
    throw new AuthCommandError("--min-expiry must use a duration such as 30m or 1h");
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * (unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000);
}
function parseAuthCommandOptions(
  args: string[],
  kind: authCommandTypes.AuthCommandKind,
): { flags: AuthCommandFlags; minExpiryMs?: number } {
  const flags: AuthCommandFlags = { args: [], credentials: false, json: false, noRefresh: false };
  let minExpiryMs: number | undefined;
  for (let index = 2; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) break;
    if (arg === "--min-expiry") {
      if (kind !== "bearer_token")
        throw new AuthCommandError("--min-expiry is only supported by print-bearer-token");
      minExpiryMs = parseMinExpiryMs(args[++index]);
      continue;
    }
    if (arg === "--json" || arg === "--credentials" || arg === "--no-refresh") {
      if (kind !== "check") throw new AuthCommandError(`${arg} is only supported by auth check`);
      if (arg === "--json") flags.json = true;
      else if (arg === "--credentials") flags.credentials = true;
      else flags.noRefresh = true;
      continue;
    }
    flags.args.push(arg);
  }
  return minExpiryMs === undefined ? { flags } : { flags, minExpiryMs };
}
function validateAuthCommandArgsImpl(
  args: argsTypes.Args,
  kind: authCommandTypes.AuthCommandKind,
): { provider?: string | undefined; model?: string | undefined } {
  const provider = args.provider?.trim() || undefined;
  const model = args.model?.trim() || undefined;
  if (args.unknownFlags.size > 0) {
    const option = args.unknownFlags.keys().next().value;
    throw new AuthCommandError(`Unknown option --${option} for "${getAuthCommandName(kind)}".`);
  }
  if (args.apiKey !== undefined || args.messages.length > 0 || args.fileArgs.length > 0) {
    throw new AuthCommandError("Auth commands only accept --provider and --model");
  }
  if (kind === "check") {
    if ((provider === undefined || provider === "") && (model === undefined || model === "")) {
      throw new AuthCommandError("Auth checks require --provider <provider> or --model <model>");
    }
    return { model, provider };
  }
  if ((provider === undefined || provider === "") && (model === undefined || model === "")) {
    throw new AuthCommandError(
      "Credential printing requires --provider <provider> or --model <model>",
    );
  }
  return { model, provider };
}
const validateAuthCommandArgs: {
  (
    args: argsTypes.Args,
    kind: authCommandTypes.AuthCommandKind,
  ): { provider?: string | undefined; model?: string | undefined };
  (
    kind: authCommandTypes.AuthCommandKind,
  ): (args: argsTypes.Args) => { provider?: string | undefined; model?: string | undefined };
} = dual((args: IArguments) => args.length >= 2, validateAuthCommandArgsImpl);
function getAuthCredential(auth: aiTypes.AuthResult | undefined): string | undefined {
  if (auth?.auth.apiKey !== undefined && auth?.auth.apiKey !== "") return auth.auth.apiKey;
  const authorization = Object.entries(auth?.auth.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "authorization",
  )?.[1];
  return typeof authorization === "string"
    ? /^Bearer\s+(.+)$/iu.exec(authorization)?.[1]
    : undefined;
}

const authCommand = {
  getAuthCommandName,
  getAuthCommandUsage,
  getAuthCredential,
  isAuthCommandHelp,
  parseAuthCommand,
  printAuthCommandHelp,
  validateAuthCommandArgs,
};

export default authCommand;
