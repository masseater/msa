import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { Console, Effect } from "effect";

import type { AuthEvent, AuthPrompt, OAuthCredential, Provider } from "./index.ts";
import { builtinProviders } from "./providers/all.ts";
import { randomUuid } from "./utils/crypto.ts";
import { toErrorMessage } from "./utils/errors.ts";

const AUTH_FILE = "auth.json";
const PROVIDERS = builtinProviders().filter(
  (provider): provider is Provider & { auth: { oauth: NonNullable<Provider["auth"]["oauth"]> } } =>
    provider.auth.oauth !== undefined,
);

type Readline = ReturnType<typeof createInterface>;

const readline = Effect.acquireRelease(
  Effect.sync(() => createInterface({ input: process.stdin, output: process.stdout })),
  (rl) => Effect.sync(() => rl.close()),
);

const prompt = (rl: Readline, question: string): Effect.Effect<string> =>
  Effect.callback<string>((resume) => {
    rl.question(question, (answer) => resume(Effect.succeed(answer)));
  });

function loadAuth(): Record<string, OAuthCredential> {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as Record<string, OAuthCredential>;
  } catch {
    return {};
  }
}

function saveAuth(auth: Record<string, OAuthCredential>): void {
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), "utf-8");
}

const answerPrompt = Effect.fn("answerPrompt")(function* (rl: Readline, authPrompt: AuthPrompt) {
  if (authPrompt.type === "select") {
    yield* Console.log(`\n${authPrompt.message}`);
    for (const [index, option] of authPrompt.options.entries()) {
      yield* Console.log(`  ${index + 1}. ${option.label}`);
    }
    const answer = yield* prompt(rl, `Enter number (1-${authPrompt.options.length}): `);
    const selected = authPrompt.options[Number.parseInt(answer, 10) - 1];
    if (selected === undefined) return yield* Effect.die(new Error("Invalid selection"));
    return selected.id;
  }
  const placeholder =
    authPrompt.placeholder !== undefined && authPrompt.placeholder !== ""
      ? ` (${authPrompt.placeholder})`
      : "";
  return yield* prompt(rl, `${authPrompt.message}${placeholder}: `);
});

const showAuthEvent = (event: AuthEvent): Effect.Effect<void> => {
  switch (event.type) {
    case "auth_url":
      return Effect.andThen(
        Console.log(`\nOpen this URL in your browser:\n${event.url}`),
        event.instructions !== undefined && event.instructions !== ""
          ? Console.log(event.instructions)
          : Effect.void,
      );
    case "device_code":
      return Effect.andThen(
        Console.log(`\nOpen this URL in your browser:\n${event.verificationUri}`),
        Console.log(`Enter code: ${event.userCode}`),
      );
    case "info":
    case "progress":
      return Console.log(event.message);
    default:
      return Effect.void;
  }
};

const login = Effect.fn("login")(function* (providerId: string) {
  const provider = PROVIDERS.find((entry) => entry.id === providerId);
  if (provider === undefined)
    return yield* Effect.die(new Error(`Unknown provider: ${providerId}`));
  const rl = yield* readline;
  const context = yield* Effect.context<never>();
  const credential = yield* Effect.promise(() =>
    provider.auth.oauth.login(
      {
        signal: new AbortController().signal,
        prompt: (authPrompt) => Effect.runPromiseWith(context)(answerPrompt(rl, authPrompt)),
        notify: (event) => Effect.runSyncWith(context)(showAuthEvent(event)),
      },
      { getDeviceId: randomUuid },
    ),
  );
  const auth = loadAuth();
  auth[providerId] = credential;
  saveAuth(auth);
  yield* Console.log(`\nCredentials saved to ${AUTH_FILE}`);
}, Effect.scoped);

const chooseProvider = Effect.scoped(
  Effect.gen(function* () {
    const rl = yield* readline;
    for (const [index, provider] of PROVIDERS.entries()) {
      yield* Console.log(`  ${index + 1}. ${provider.name}`);
    }
    const answer = yield* prompt(rl, `Enter number (1-${PROVIDERS.length}): `);
    return PROVIDERS[Number.parseInt(answer, 10) - 1]?.id;
  }),
);

const HELP_COMMANDS = new Set(["", "help", "--help", "-h"]);

const usage = (): string => {
  const providerList = PROVIDERS.map(
    (provider) => `  ${provider.id.padEnd(20)} ${provider.name}`,
  ).join("\n");
  return `Usage: npx @msa/ai <command> [provider]\n\nCommands:\n  login [provider]  Login to an OAuth provider\n  list              List available providers\n\nProviders:\n${providerList}`;
};

const main = Effect.fn("main")(function* (args: readonly string[]) {
  const command = args[0];
  if (command === undefined || HELP_COMMANDS.has(command)) {
    yield* Console.log(usage());
    return;
  }
  if (command === "list") {
    for (const provider of PROVIDERS)
      yield* Console.log(`${provider.id.padEnd(20)} ${provider.name}`);
    return;
  }
  if (command !== "login") return yield* Effect.die(new Error(`Unknown command: ${command}`));
  const given = args[1];
  const providerId = given === undefined || given === "" ? yield* chooseProvider : given;
  if (
    providerId === undefined ||
    providerId === "" ||
    !PROVIDERS.some((provider) => provider.id === providerId)
  ) {
    return yield* Effect.die(new Error(`Unknown provider: ${providerId ?? ""}`));
  }
  yield* login(providerId);
});

Effect.runFork(
  main(process.argv.slice(2)).pipe(
    Effect.catchDefect((error) =>
      Console.error("Error:", toErrorMessage(error)).pipe(
        Effect.andThen(Effect.sync(() => process.exit(1))),
      ),
    ),
  ),
);
