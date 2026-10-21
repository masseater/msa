import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import providerAttribution from "../provider-attribution.ts";
import type SettingsManager from "../settings-manager.ts";

const { awaited, awaiting } = awaitingModule;
const { mergeProviderAttributionHeaders } = providerAttribution;

type RunnerRef = { current?: extensionsTypes.ExtensionRunner };

type StreamOptions = aiTypes.ModelsSimpleStreamOptions;

const MAX_TIMEOUT_MS = 2147483647;

export default class ProviderHooks {
  private readonly settingsManager: SettingsManager;

  private readonly runnerRef: RunnerRef;

  constructor(settingsManager: SettingsManager, runnerRef: RunnerRef) {
    this.settingsManager = settingsManager;
    this.runnerRef = runnerRef;
  }

  requestOptions(
    requestModel: compatTypes.Model<any>,
    streamOptions: StreamOptions = {},
  ): StreamOptions {
    const { session } = this.settingsManager;
    const retry = session.getProviderRetrySettings();
    const httpIdleTimeoutMs = session.getHttpIdleTimeoutMs();
    const headerRunner = this.runnerRef.current;
    return {
      ...streamOptions,
      maxRetries: streamOptions.maxRetries ?? retry.maxRetries,
      maxRetryDelayMs: streamOptions.maxRetryDelayMs ?? retry.maxRetryDelayMs,
      timeoutMs:
        streamOptions.timeoutMs ??
        retry.timeoutMs ??
        (httpIdleTimeoutMs === 0 ? MAX_TIMEOUT_MS : httpIdleTimeoutMs),
      transformHeaders: (requestHeaders) =>
        Effect.runPromise(
          awaiting(() =>
            this.transformHeaders(requestModel, streamOptions, requestHeaders, headerRunner),
          ),
        ),
      websocketConnectTimeoutMs:
        streamOptions.websocketConnectTimeoutMs ?? session.getWebSocketConnectTimeoutMs(),
    };
  }

  transformPayload(payload: unknown): Promise<unknown> {
    const runner = this.runnerRef.current;
    if (runner?.hasHandlers("before_provider_request") !== true) return Promise.resolve(payload);
    return Effect.runPromise(awaiting(() => awaited(runner.emitBeforeProviderRequest(payload))));
  }

  handleResponse: NonNullable<StreamOptions["onResponse"]> = (response) =>
    this.emit({
      headers: response.headers,
      status: response.status,
      type: "after_provider_response",
    });

  handleStreamEvent: NonNullable<StreamOptions["onProviderStreamEvent"]> = (data, eventModel) =>
    this.emit({
      api: eventModel.api,
      data,
      model: eventModel.id,
      provider: eventModel.provider,
      type: "provider_stream_event",
    });

  transformContext(messages: agentTypes.AgentMessage[]): Promise<agentTypes.AgentMessage[]> {
    const runner = this.runnerRef.current;
    if (runner === undefined) return Promise.resolve(messages);
    return Effect.runPromise(awaiting(() => awaited(runner.emitContext(messages))));
  }

  private *transformHeaders(
    requestModel: compatTypes.Model<any>,
    streamOptions: StreamOptions,
    requestHeaders: Parameters<NonNullable<StreamOptions["transformHeaders"]>>[0],
    headerRunner: extensionsTypes.ExtensionRunner | undefined,
  ) {
    const headers = mergeProviderAttributionHeaders(
      requestModel,
      this.settingsManager,
      streamOptions.sessionId,
      requestHeaders,
    );
    return yield* awaited(
      headerRunner?.hasHandlers("before_provider_headers") === true
        ? headerRunner.emitBeforeProviderHeaders(headers ?? {})
        : (headers ?? {}),
    );
  }

  private emit(
    event:
      | { type: "after_provider_response"; headers: Record<string, string>; status: number }
      | {
          type: "provider_stream_event";
          api: string;
          data: unknown;
          model: string;
          provider: string;
        },
  ): Promise<void> {
    const runner = this.runnerRef.current;
    if (runner?.hasHandlers(event.type) !== true) return Promise.resolve();
    return Effect.runPromise(
      awaiting(function* () {
        yield* awaited(
          runner.emit(event as Parameters<extensionsTypes.ExtensionRunner["emit"]>[0]),
        );
      }),
    );
  }
}
