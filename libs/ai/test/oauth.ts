import * as NodeServices from "@effect/platform-node/NodeServices";
import { Cause, Console, Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";

import type typesModule from "../src/auth/types.ts";
import all from "../src/providers/all.ts";
import clock from "../src/utils/clock.ts";
import env from "./env.ts";

const { builtinProviders } = all;
const { currentTimeMillis } = clock;

const { envValue } = env;

type ApiKeyCredential = {
  type: "api_key";
  key: string;
};

type OAuthCredentialEntry = {
  type: "oauth";
} & typesModule.OAuthCredentials;

type AuthCredential = ApiKeyCredential | OAuthCredentialEntry;

type AuthStorage = Record<string, AuthCredential>;

const decodeStorage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const encodeStorage = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const authPath = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = envValue("HOME") ?? envValue("USERPROFILE") ?? "";
  return path.join(home, ".msa", "agent", "auth.json");
});

const loadAuthStorage = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* authPath;
  if (!(yield* Effect.orElseSucceed(fs.exists(file), () => false))) return {};
  return yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeStorage),
    Effect.map((value) => value as AuthStorage),
    Effect.orElseSucceed((): AuthStorage => ({})),
  );
});

const saveAuthStorage = (storage: AuthStorage) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = yield* authPath;
    yield* fs.makeDirectory(path.dirname(file), { mode: 0o700, recursive: true });
    yield* fs.writeFileString(file, yield* encodeStorage(storage));
    yield* fs.chmod(file, 0o600);
  });

const refreshed = (provider: string, entry: OAuthCredentialEntry) =>
  Effect.gen(function* () {
    const oauth = builtinProviders().find((candidate) => candidate.id === provider)?.auth.oauth;
    if (oauth === undefined) return undefined;
    const credential: OAuthCredentialEntry =
      currentTimeMillis() >= entry.expires
        ? {
            ...(yield* Effect.promise(() => oauth.refresh(entry, new AbortController().signal))),
            type: "oauth",
          }
        : entry;
    return { credential, oauth };
  });

const resolveStored = (provider: string) =>
  Effect.gen(function* () {
    const storage = yield* loadAuthStorage;
    const entry = storage[provider];
    if (entry === undefined) return undefined;
    if (entry.type === "api_key") return entry.key;
    const resolved = yield* refreshed(provider, entry);
    if (resolved === undefined) return undefined;
    yield* Effect.orDie(saveAuthStorage({ ...storage, [provider]: resolved.credential }));
    return (yield* Effect.promise(() => resolved.oauth.toAuth(resolved.credential))).apiKey;
  });

const runtime = ManagedRuntime.make(NodeServices.layer);

const resolveApiKey = (provider: string): Promise<string | undefined> =>
  runtime.runPromise(
    resolveStored(provider).pipe(
      Effect.catchCause((cause) => Effect.as(Console.log(Cause.pretty(cause)), undefined)),
    ),
  );

export default resolveApiKey;
