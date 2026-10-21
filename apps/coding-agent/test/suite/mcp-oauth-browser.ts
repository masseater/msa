import * as NodeServices from "@effect/platform-node/NodeServices";
import { Crypto, Effect, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

const runtime = ManagedRuntime.make(NodeServices.layer);

const clientDocumentId = (serverUrl: string): Promise<string> =>
  runtime.runPromise(
    Effect.map(
      Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(serverUrl))),
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
