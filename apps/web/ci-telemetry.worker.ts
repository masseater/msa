import { Effect, Logger, ManagedRuntime, Schema, String as Str, pipe } from "effect";
import { createRemoteJWKSet, jwtVerify } from "jose";

import CI_TELEMETRY_AUDIENCE from "./ci-telemetry-audience.ts";
import type ciTelemetryTypes from "./ci-telemetry.types.ts";

const ISSUER = "https://token.actions.githubusercontent.com";

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

const Claims = Schema.Struct({
  event_name: Schema.String,
  ref: Schema.String,
  repository: Schema.String,
  run_attempt: Schema.String,
  run_id: Schema.String,
  sha: Schema.String,
  workflow: Schema.String,
});

const Timed = Schema.Struct({
  completed_at: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  name: Schema.String,
  started_at: Schema.String,
});

const Job = Schema.Struct({
  ...Timed.fields,
  id: Schema.Finite,
  runner_name: Schema.NullOr(Schema.String),
  steps: Schema.Array(Schema.Struct({ ...Timed.fields, number: Schema.Finite })),
});

const Payload = Schema.Struct({ jobs: Schema.Array(Job) });

type Run = Readonly<Record<string, string>>;

const taggedError = Schema.TaggedError;

class Unauthorized extends taggedError<Unauthorized, { readonly brand: unique symbol }>()(
  "Unauthorized",
  { reason: Schema.String },
) {}

const runtime = ManagedRuntime.make(
  Logger.layer([Logger.withLeveledConsole(Logger.formatStructured)]),
);

const bearer = (request: Request): string =>
  pipe(request.headers.get("authorization") ?? "", Str.replace(/^Bearer /u, ""));

const verify = (
  request: Request,
  env: ciTelemetryTypes.Env,
): Effect.Effect<typeof Claims.Type, Unauthorized | Schema.SchemaError> =>
  Effect.gen(function* verifyClaims() {
    const { payload } = yield* Effect.tryPromise({
      catch: (error) => Unauthorized.make({ reason: String(error) }),
      try: () =>
        jwtVerify(bearer(request), jwks, { audience: CI_TELEMETRY_AUDIENCE, issuer: ISSUER }),
    });
    const claims = yield* Schema.decodeUnknownEffect(Claims)(payload);
    if (claims.repository !== env.GITHUB_REPOSITORY) {
      return yield* Unauthorized.make({ reason: `unexpected repository ${claims.repository}` });
    }
    return claims;
  });

const timing = (timed: typeof Timed.Type): Readonly<Record<string, unknown>> => ({
  completedAt: timed.completed_at,
  conclusion: timed.conclusion,
  durationMs: Date.parse(timed.completed_at) - Date.parse(timed.started_at),
  name: timed.name,
  startedAt: timed.started_at,
});

const logJob = (run: Run, job: typeof Job.Type): Effect.Effect<void> =>
  Effect.gen(function* logJobAndSteps() {
    const context = { ...run, job: job.name, jobId: job.id, runner: job.runner_name };
    yield* Effect.logInfo("ci.job").pipe(Effect.annotateLogs({ ...context, ...timing(job) }));
    yield* pipe(
      job.steps,
      Effect.forEach((step) =>
        Effect.logInfo("ci.step").pipe(
          Effect.annotateLogs({ ...context, ...timing(step), stepNumber: step.number }),
        ),
      ),
    );
  });

const toRun = (claims: typeof Claims.Type): Run => ({
  event: claims.event_name,
  ref: claims.ref,
  repository: claims.repository,
  runAttempt: claims.run_attempt,
  runId: claims.run_id,
  sha: claims.sha,
  workflow: claims.workflow,
});

const record = (request: Request, env: ciTelemetryTypes.Env): Effect.Effect<Response> =>
  Effect.gen(function* recordRun() {
    const claims = yield* verify(request, env);
    const body = yield* Effect.tryPromise(() => request.json());
    const { jobs } = yield* Schema.decodeUnknownEffect(Payload)(body);
    yield* pipe(
      jobs,
      Effect.forEach((job) => logJob(toRun(claims), job)),
    );
    return new Response("", { status: 202 });
  }).pipe(
    Effect.catchTag("Unauthorized", (unauthorized) =>
      Effect.logWarning("ci.unauthorized").pipe(
        Effect.annotateLogs({ reason: unauthorized.reason }),
        Effect.as(new Response("", { status: 401 })),
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.logError("ci.rejected", cause).pipe(Effect.as(new Response("", { status: 400 }))),
    ),
  );

const worker = {
  fetch: (request: Request, env: ciTelemetryTypes.Env): Promise<Response> =>
    runtime.runPromise(record(request, env)),
};

export default worker;
