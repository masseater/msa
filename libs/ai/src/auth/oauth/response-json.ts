import { Effect } from "effect";

import type { HttpReply } from "../../utils/http.ts";

export const REQUEST_TIMEOUT_MS = 30 * 1000;

export const formHeaders = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
} as const;

export const requestSignal = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);

export const readJson = (reply: HttpReply): Effect.Effect<Record<string, unknown> | null> =>
  reply.json.pipe(
    Effect.map((json) =>
      json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null,
    ),
    Effect.catchDefect(() => Effect.succeed(null)),
  );

export const readText = (reply: HttpReply): Effect.Effect<string> =>
  reply.text.pipe(Effect.catchDefect(() => Effect.succeed("")));

export const errorDetail = (json: Record<string, unknown> | null): string => {
  for (const key of ["error_description", "detail", "message", "error"]) {
    const value = json?.[key];
    if (typeof value === "string" && value.trim() !== "") return `: ${value.trim()}`;
  }
  return "";
};

export const trustedHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
};

export const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
