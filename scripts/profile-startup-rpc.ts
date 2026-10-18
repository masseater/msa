import { Effect, Predicate, Ref, Result, Schema } from "effect";

import { fail } from "./profile-startup-args.ts";
import type { ProfileError } from "./profile-startup-args.ts";
import { nowMs } from "./profile-startup-report.ts";

const decodeRpcResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeRequest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, type: Schema.String })),
);

const getStateRequest = (requestId: string) =>
  Effect.map(encodeRequest({ id: requestId, type: "get_state" }), (request) => `${request}\n`);

interface RpcState {
  readonly readyElapsedMs: number | undefined;
  readonly responseError: string | undefined;
}

const GetStateResponse = Schema.Struct({
  command: Schema.Literal("get_state"),
  error: Schema.optional(Schema.Unknown),
  id: Schema.String,
  success: Schema.optional(Schema.Unknown),
  type: Schema.Literal("response"),
});
const isGetStateResponse = Schema.is(GetStateResponse);

interface LineContext {
  readonly onReady: Effect.Effect<void>;
  readonly requestId: string;
  readonly startedAt: number;
  readonly state: Ref.Ref<RpcState>;
}

const recordError = (state: Ref.Ref<RpcState>, responseError: string) =>
  Ref.update(state, (current) => ({ ...current, responseError }));

const responseErrorOf = (response: typeof GetStateResponse.Type): string =>
  Predicate.isString(response.error) ? response.error : "get_state failed";

const markReady = (context: LineContext) =>
  Effect.gen(function* () {
    if ((yield* Ref.get(context.state)).readyElapsedMs !== undefined) return;
    const readyElapsedMs = (yield* nowMs) - context.startedAt;
    yield* Ref.update(context.state, (current) => ({ ...current, readyElapsedMs }));
    yield* context.onReady;
  });

const handleResponse = (context: LineContext, response: unknown): Effect.Effect<void> => {
  if (!isGetStateResponse(response) || response.id !== context.requestId) return Effect.void;
  return response.success === true
    ? markReady(context)
    : recordError(context.state, responseErrorOf(response));
};

const handleLine = (context: LineContext) => (line: string) =>
  Effect.gen(function* () {
    if (line.trim() === "") return;
    const decoded = yield* decodeRpcResponse(line).pipe(Effect.result);
    yield* Result.isFailure(decoded)
      ? recordError(context.state, decoded.failure.message)
      : handleResponse(context, decoded.success);
  });

const missingResponse = (stderr: string) =>
  fail(stderr.trim() === "" ? "RPC benchmark did not receive get_state response" : stderr.trim());

const rpcElapsed = ({
  state,
  stderr,
}: {
  readonly state: RpcState;
  readonly stderr: string;
}): Effect.Effect<number, ProfileError> => {
  if (state.responseError !== undefined) return Effect.fail(fail(state.responseError));
  if (state.readyElapsedMs === undefined) return Effect.fail(missingResponse(stderr));
  return Effect.succeed(state.readyElapsedMs);
};

export type { LineContext, RpcState };
export { getStateRequest, handleLine, rpcElapsed };
