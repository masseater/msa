import * as Effect from "effect/Effect";

import configModule from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import managementHttp from "../management-http.ts";

const { APP_NAME } = configModule;
const { fetchWithRetry } = managementHttp;
const { awaited, awaiting } = awaitingModule;

const NETWORK_TIMEOUT_MS = 10_000;

function getLatestVersion(repo: string): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const response = yield* awaited(
        fetchWithRetry(
          `https://github.com/${repo}/releases/latest`,
          {
            headers: { "User-Agent": `${APP_NAME}-coding-agent` },
            redirect: "manual",
          },
          { timeoutMs: NETWORK_TIMEOUT_MS },
        ),
      );

      try {
        yield* awaited(response.body?.cancel());
      } catch {}

      const location =
        response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (location === null || location === "") {
        throw new Error(
          `Failed to resolve latest ${repo} release: HTTP ${response.status} without redirect`,
        );
      }

      const tag = new URL(location, "https://github.com").pathname.split("/").pop();
      if (tag === undefined || tag === "" || !location.includes("/releases/tag/")) {
        throw new Error(
          `Failed to resolve latest ${repo} release: unexpected redirect to ${location}`,
        );
      }
      return decodeURIComponent(tag).replace(/^v/u, "");
    }),
  );
}

const latestVersion = { getLatestVersion };

export default latestVersion;
