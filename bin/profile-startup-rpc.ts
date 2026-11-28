import { Effect, Predicate, Ref, Result, Schema } from "effect";

import profileStartupArgs from "./profile-startup-args.ts";
import type profileStartupArgsTypes from "./profile-startup-args.types.ts";
import profileStartupReport from "./profile-startup-report.ts";
import type profileStartupRpcTypes from "./profile-startup-rpc.types.ts";

const { nowMs } = profileStartupReport;
const { fail } = profileStartupArgs;

const decodeRpcResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeRequest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, type: Schema.String })),
);

const getStateRequest = (requestId: string) =>
  Effect.map(encodeRequest({ id: requestId, type: "get_state" }), (request) => `${request}\n`);

const GetStateResponse = Schema.Struct({
  command: Schema.Literal("get_state"),
  error: Schema.optional(Schema.Unknown),
  id: Schema.String,
  success: Schema.optional(Schema.Unknown),
  type: Schema.Literal("response"),
});
const isGetStateResponse = Schema.is(GetStateResponse);

const recordError = (state: Ref.Ref<profileStartupRpcTypes.RpcState>, responseError: string) =>
  Ref.update(state, (current) => ({ ...current, responseError }));

const responseErrorOf = (response: typeof GetStateResponse.Type): string =>
  Predicate.isString(response.error) ? response.error : "get_state failed";

const markReady = (context: profileStartupRpcTypes.LineContext) =>
  Effect.gen(function* () {
    if ((yield* Ref.get(context.state)).readyElapsedMs !== undefined) return;
    const readyElapsedMs = (yield* nowMs) - context.startedAt;
    yield* Ref.update(context.state, (current) => ({ ...current, readyElapsedMs }));
    yield* context.onReady;
  });

const handleResponse = (
  context: profileStartupRpcTypes.LineContext,
  response: unknown,
): Effect.Effect<void> => {
  if (!isGetStateResponse(response) || response.id !== context.requestId) return Effect.void;
  return response.success === true
    ? markReady(context)
    : recordError(context.state, responseErrorOf(response));
};

const handleLine = (context: profileStartupRpcTypes.LineContext) => (line: string) =>
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
  readonly state: profileStartupRpcTypes.RpcState;
  readonly stderr: string;
}): Effect.Effect<number, profileStartupArgsTypes.ProfileError> => {
  if (state.responseError !== undefined) return Effect.fail(fail(state.responseError));
  if (state.readyElapsedMs === undefined) return Effect.fail(missingResponse(stderr));
  return Effect.succeed(state.readyElapsedMs);
};

const profileStartupRpc = {
  getStateRequest,
  handleLine,
  rpcElapsed,
};

export default profileStartupRpc;
