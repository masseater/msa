import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import platformCommand from "../../../core/platform/command.ts";
import platform from "../../../core/platform/index.ts";
import transport from "../transport.ts";
import type secretStoresTypes from "./secret-stores.types.ts";

const { awaited, awaiting } = awaitingModule;
const { runCommand } = platformCommand;
const { expandHome } = transport;
const { sha256Hex } = platform;

const HELPER_SERVER_URL = "https://msa.invalid/mcp-oauth";
const HELPER_USERNAME = "msa";
const KEYCHAIN_SERVICE = "msa";
const HELPER_TIMEOUT_MS = 30_000;
const KEYCHAIN_TIMEOUT_MS = 10_000;
const MACOS_ITEM_NOT_FOUND = 44;

type SecretStore = secretStoresTypes.SecretStore;

const run = (file: string, args: readonly string[], input: string | undefined, timeoutMs: number) =>
  runCommand({
    args,
    file,
    ...(input === undefined ? {} : { input }),
    signal: AbortSignal.timeout(timeoutMs),
  });

const failure = (what: string, output: { stderr: string; lines: readonly string[] }) => {
  const detail = (output.stderr.trim() || output.lines.join("\n").trim()).split("\n", 1)[0];
  return new Error(detail === undefined || detail === "" ? what : `${what}: ${detail}`);
};

function credentialHelperStore(helper: secretStoresTypes.CredentialHelperConfig): SecretStore {
  const file = expandHome(helper.command);
  const args = (helper.args ?? []).map(expandHome);
  const call = (action: string, input: string) =>
    run(file, [...args, action], input, HELPER_TIMEOUT_MS);
  return {
    description: `credential helper ${helper.command}`,
    persistent: true,
    read: () =>
      Effect.runPromise(
        awaiting(function* () {
          const output = yield* awaited(call("get", HELPER_SERVER_URL));
          const text = output.lines.join("\n").trim();
          if (output.exitCode !== 0) {
            if (/not found/iu.test(text)) return undefined;
            throw failure(`${helper.command} get failed`, output);
          }
          const parsed: unknown = JSON.parse(text);
          const secret =
            typeof parsed === "object" && parsed !== null && "Secret" in parsed
              ? parsed.Secret
              : undefined;
          if (typeof secret !== "string")
            throw new Error(`${helper.command} get returned no Secret`);
          return secret;
        }),
      ),
    write: (value) =>
      Effect.runPromise(
        awaiting(function* () {
          const output = yield* awaited(
            call(
              "store",
              JSON.stringify({
                Secret: value,
                ServerURL: HELPER_SERVER_URL,
                Username: HELPER_USERNAME,
              }),
            ),
          );
          if (output.exitCode !== 0) throw failure(`${helper.command} store failed`, output);
        }),
      ),
  };
}

const decodeBase64 = (text: string) => Buffer.from(text, "base64").toString("utf8");

const macosKeychainStore = (account: string): SecretStore => ({
  description: "the macOS login keychain",
  persistent: true,
  read: () =>
    Effect.runPromise(
      awaiting(function* () {
        const output = yield* awaited(
          run(
            "/usr/bin/security",
            ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
            undefined,
            KEYCHAIN_TIMEOUT_MS,
          ),
        );
        if (output.exitCode === MACOS_ITEM_NOT_FOUND) return undefined;
        if (output.exitCode !== 0) throw failure("The macOS keychain could not be read", output);
        return decodeBase64(output.lines.join("").trim());
      }),
    ),
  write: (value) =>
    Effect.runPromise(
      awaiting(function* () {
        const encoded = Buffer.from(value, "utf8").toString("base64");
        const output = yield* awaited(
          run(
            "/usr/bin/security",
            ["-i"],
            `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -w ${encoded}\n`,
            KEYCHAIN_TIMEOUT_MS,
          ),
        );
        if (output.exitCode !== 0) throw failure("The macOS keychain could not be written", output);
      }),
    ),
});

const secretServiceStore = (account: string): SecretStore => {
  const attributes = ["service", KEYCHAIN_SERVICE, "account", account];
  return {
    description: "the Secret Service keyring (secret-tool)",
    persistent: true,
    read: () =>
      Effect.runPromise(
        awaiting(function* () {
          const output = yield* awaited(
            run("secret-tool", ["lookup", ...attributes], undefined, KEYCHAIN_TIMEOUT_MS),
          );
          if (output.exitCode === 0) return output.lines.join("\n");
          if (output.exitCode === 1 && output.stderr.trim() === "") return undefined;
          throw failure("The Secret Service keyring could not be read", output);
        }),
      ),
    write: (value) =>
      Effect.runPromise(
        awaiting(function* () {
          const output = yield* awaited(
            run(
              "secret-tool",
              ["store", "--label", "msa MCP sign-ins", ...attributes],
              value,
              KEYCHAIN_TIMEOUT_MS,
            ),
          );
          if (output.exitCode !== 0)
            throw failure("The Secret Service keyring could not be written", output);
        }),
      ),
  };
};

function memoryStore(initial: string | undefined): SecretStore {
  let value = initial;
  return {
    description: "memory, until msa exits",
    persistent: false,
    read: () => Promise.resolve(value),
    write: (next) => {
      value = next;
      return Promise.resolve();
    },
  };
}

function platformStore(platformName: NodeJS.Platform, agentDir: string): SecretStore | undefined {
  const account = `mcp-oauth-${sha256Hex(agentDir).slice(0, 16)}`;
  if (platformName === "darwin") return macosKeychainStore(account);
  if (platformName === "linux") return secretServiceStore(account);
  return undefined;
}

const secretStores = { credentialHelperStore, memoryStore, platformStore };

export default secretStores;
