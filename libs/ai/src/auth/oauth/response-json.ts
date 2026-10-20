import { Effect } from "effect";

import type httpTypes from "../../utils/http.types.ts";

const REQUEST_TIMEOUT_MS = 30 * 1000;

const formHeaders = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
} as const;

const requestSignal = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);

const readJson = (reply: httpTypes.HttpReply): Effect.Effect<Record<string, unknown> | null> =>
  reply.json.pipe(
    Effect.map((json) =>
      json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null,
    ),
    Effect.catchDefect(() => Effect.succeed(null)),
  );

const readText = (reply: httpTypes.HttpReply): Effect.Effect<string> =>
  reply.text.pipe(Effect.catchDefect(() => Effect.succeed("")));

const errorDetail = (json: Record<string, unknown> | null): string => {
  for (const key of ["error_description", "detail", "message", "error"]) {
    const value = json?.[key];
    if (typeof value === "string" && value.trim() !== "") return `: ${value.trim()}`;
  }
  return "";
};

const trustedHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
};

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const responseJson = {
  REQUEST_TIMEOUT_MS,
  errorDetail,
  formHeaders,
  positiveNumber,
  readJson,
  readText,
  requestSignal,
  trustedHttpUrl,
};

export default responseJson;
