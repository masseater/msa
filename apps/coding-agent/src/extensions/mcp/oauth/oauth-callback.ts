import oauthPage from "@msa/ai/utils/oauth-page";
import oauth from "@msa/mcp/oauth";
import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import type oauthInternalTypes from "../oauth-internal.types.ts";
import type oauthTypesNs from "../oauth.types.ts";
import McpSignInCancelledError from "../sign-in-cancelled.ts";

const { awaited, awaiting } = awaitingModule;
const { oauthErrorHtml, oauthSuccessHtml } = oauthPage;
const { OAuthCallbackServer } = oauth;

function responseFromRedirectUrl(
  input: string,
  state: string,
  redirectUrl: URL,
): oauthInternalTypes.AuthorizationResponse {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Expected the full redirect URL from the browser address bar");
  }

  if (url.origin !== redirectUrl.origin || url.pathname !== redirectUrl.pathname) {
    throw new Error("The redirect URL does not match this sign-in's redirect URI");
  }
  const error = url.searchParams.get("error");
  if (error !== null && error !== "")
    throw new Error(url.searchParams.get("error_description") ?? error);
  if (url.searchParams.get("state") !== state)
    throw new Error("The redirect URL belongs to a different sign-in");
  const code = url.searchParams.get("code");
  if (code === null || code === "")
    throw new Error("The redirect URL does not contain an authorization code");
  const iss = url.searchParams.get("iss");
  return { code, ...(iss === null ? {} : { iss }) };
}

function waitForAuthorizationResponse(
  callback: oauthTypes.OAuthCallbackServer,
  state: string,
  redirectUrl: URL,
  prompt: oauthTypesNs.McpSignInPrompt,
  signal: AbortSignal | undefined,
): Promise<oauthInternalTypes.AuthorizationResponse> {
  return Effect.runPromise(
    awaiting(function* () {
      const controller = new AbortController();
      const promptSignal =
        signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
      const fromBrowser = callback.waitForCallback(state, redirectUrl.pathname);
      const fromUser = prompt.promptForRedirectUrl(promptSignal).then((input) => {
        if (input === undefined || input.trim() === "") throw McpSignInCancelledError.create();
        return responseFromRedirectUrl(input, state, redirectUrl);
      });
      try {
        return yield* awaited(Promise.race([fromBrowser, fromUser]));
      } finally {
        controller.abort();
        fromBrowser.catch(() => undefined);
        fromUser.catch(() => undefined);
      }
    }),
  );
}

function listenForCallback(
  settings: oauthInternalTypes.CallbackSettings,
  extraPaths: string[],
  port: number | undefined,
  required: boolean,
): Promise<oauthTypes.OAuthCallbackServer> {
  return Effect.runPromise(
    awaiting(function* () {
      const options = {
        extraPaths,
        host: settings.host,
        path: settings.path,
        redirectHost: settings.redirectHost,
        renderPage: (page: oauthTypes.OAuthCallbackPage) =>
          page.ok
            ? oauthSuccessHtml("Signed in to the MCP server. You may now close this page.")
            : oauthErrorHtml(page.message, page.details),
      };
      try {
        return yield* awaited(OAuthCallbackServer.listen({ ...options, port: port ?? 0 }));
      } catch (error) {
        if (required || port === undefined) throw error;
        return yield* awaited(OAuthCallbackServer.listen(options));
      }
    }),
  );
}

const oauthCallback = {
  listenForCallback,
  waitForAuthorizationResponse,
};

export default oauthCallback;
