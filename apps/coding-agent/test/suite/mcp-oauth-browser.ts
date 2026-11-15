import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { Effect, ManagedRuntime } from "effect";
import { Digest } from "effect/crypto";
import { FetchHttpClient, HttpClient } from "effect/http";

const runtime = ManagedRuntime.make(NodeCrypto.layerDigest);

const clientDocumentId = (serverUrl: string): Promise<string> =>
  runtime.runPromise(
    Effect.map(
      Digest.Digest.use((digest) =>
        digest.digest(Digest.sha256, new TextEncoder().encode(serverUrl)),
      ),
      (digest) => Buffer.from(digest).subarray(0, 9).toString("base64url"),
    ),
  );

const browserRuntime = ManagedRuntime.make(FetchHttpClient.layer);

const visitAuthorizationUrl = (url: URL): void => {
  void browserRuntime.runPromise(HttpClient.get(url).pipe(Effect.ignore));
};

const waitForAbort = (signal: AbortSignal): Promise<undefined> =>
  runtime.runPromise(
    Effect.callback<undefined>((resume) => {
      signal.addEventListener("abort", () => resume(Effect.undefined), { once: true });
    }),
  );

const browserPrompt = (onOpen: (url: URL) => void = () => {}) => ({
  promptForRedirectUrl: waitForAbort,
  showAuthorizationUrl: (url: URL) => {
    onOpen(url);
    visitAuthorizationUrl(url);
  },
});

const mcpOauthBrowser = {
  browserPrompt,
  clientDocumentId,
};

export default mcpOauthBrowser;
