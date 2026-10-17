/**
 * Calls treg (https://treg.to) routed jobs, which try web vendors in order until one answers.
 *
 * treg's OpenAPI document declares `/call/{rest}` with no request body and an untyped response, so
 * a generated client cannot send a job; this is a thin Effect HTTP call instead.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const TREG_URL = "https://treg.to";
/** TinyFish answers web search and page reads for free; treg falls back to paid vendors after it. */
const PREFERRED_VENDOR = "tinyfish";
/** Caps what one call may spend walking paid vendors after a miss. treg's own default is $1. */
const MAX_COST_USD = "0.05";

const TregResponse = Schema.Struct({
  output: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  _treg: Schema.optionalKey(
    Schema.Struct({
      served_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
      charged_micro: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    }),
  ),
});

export interface TregOptions {
  token: Redacted.Redacted<string>;
  /** The team an identity token from `treg login` acts for, sent as `X-Treg-Org`. */
  org?: string;
  /** Replaces `globalThis.fetch`, for tests. */
  fetch?: typeof globalThis.fetch;
}

export interface TregResult {
  output: Readonly<Record<string, unknown>>;
  servedBy?: string;
  costMicro?: number;
}

const TregCliConfig = Schema.fromJsonString(
  Schema.Struct({
    token: Schema.optionalKey(Schema.NullOr(Schema.String)),
    active_org: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

/**
 * The treg credentials: `TREG_TOKEN`, else the login `treg login` saved in `~/.treg/config.json`.
 * Undefined when neither exists, which leaves the web tools out.
 */
export function getTregCredentials(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Pick<TregOptions, "token" | "org"> | undefined {
  const token = env["TREG_TOKEN"]?.trim();
  if (token) return { token: Redacted.make(token) };
  let config: string;
  try {
    config = readFileSync(join(home, ".treg", "config.json"), "utf8");
  } catch {
    return undefined;
  }
  return Option.match(Schema.decodeUnknownOption(TregCliConfig)(config), {
    onNone: () => undefined,
    onSome: ({ token: saved, active_org: org }) =>
      saved?.trim() ? { token: Redacted.make(saved.trim()), ...(org ? { org } : {}) } : undefined,
  });
}

function describeFailure(status: number, body: unknown): string {
  const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : body;
  return `treg returned ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
}

/** Run a treg routed job such as `treg.web.search` and return its normalized `output`. */
export function callTreg(
  options: TregOptions,
  job: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<TregResult> {
  const program = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(`${TREG_URL}/call/${job}`).pipe(
        HttpClientRequest.setHeaders({
          "X-Treg-Token": Redacted.value(options.token),
          "X-Treg-Route-Prefer": PREFERRED_VENDOR,
          "X-Treg-Route-Max-Cost": MAX_COST_USD,
          ...(options.org ? { "X-Treg-Org": options.org } : {}),
        }),
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    );
    if (response.status >= 400) {
      const failure = yield* Effect.orElseSucceed(response.json, () => null);
      return yield* Effect.fail(new Error(describeFailure(response.status, failure)));
    }
    const decoded = yield* HttpClientResponse.schemaBodyJson(TregResponse)(response);
    const result: TregResult = { output: decoded.output ?? {} };
    if (decoded._treg?.served_by) result.servedBy = decoded._treg.served_by;
    if (typeof decoded._treg?.charged_micro === "number") {
      result.costMicro = decoded._treg.charged_micro;
    }
    return result;
  }).pipe(Effect.provide(FetchHttpClient.layer));
  return Effect.runPromise(
    options.fetch
      ? program.pipe(Effect.provideService(FetchHttpClient.Fetch, options.fetch))
      : program,
    { signal },
  );
}

/** A string field of a vendor's row, trying the names vendors use for it in order. */
export function pickString(row: unknown, ...keys: string[]): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The rows of an output field, which treg leaves null on a miss. */
export function rows(output: Readonly<Record<string, unknown>>, key: string): unknown[] {
  const value = output[key];
  return Array.isArray(value) ? value : [];
}
