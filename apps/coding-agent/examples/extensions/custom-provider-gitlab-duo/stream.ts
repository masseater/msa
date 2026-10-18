import {
  type Api,
  type AssistantMessageEventStream,
  anthropicMessagesApi,
  createAssistantMessageEventStream,
  type Model,
  openAIResponsesApi,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@msa/ai/compat";
import { Clock, Data, Effect, Stream } from "effect";
import { dual } from "effect/Function";

import { getDirectAccessToken, GitLabAuthError } from "./auth.ts";
import { MODEL_MAP } from "./config.ts";

class GitLabStreamError extends Data.TaggedError("GitLabStreamError")<{
  readonly message: string;
}> {}

const errorEvent = (model: Model<Api>, message: string, timestamp: number) => ({
  type: "error" as const,
  reason: "error" as const,
  error: {
    role: "assistant" as const,
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error" as const,
    errorMessage: message,
    timestamp,
  },
});

const openInnerStream = (
  backend: string,
  modelWithBaseUrl: Model<Api>,
  context: TranscriptContext,
  streamOptions: SimpleStreamOptions,
) => {
  if (backend === "anthropic") {
    const anthropicModel = modelWithBaseUrl as Model<"anthropic-messages">;
    return anthropicMessagesApi().streamSimple(
      {
        ...anthropicModel,
        compat: { ...anthropicModel.compat, forceAdaptiveThinking: true },
      },
      context,
      streamOptions,
    );
  }
  return openAIResponsesApi().streamSimple(
    modelWithBaseUrl as Model<"openai-responses">,
    context,
    streamOptions,
  );
};

const runStream = (
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
) =>
  Effect.gen(function* () {
    const gitlabAccessToken = options?.apiKey;
    if (gitlabAccessToken === undefined || gitlabAccessToken.length === 0) {
      return yield* new GitLabStreamError({
        message: "No GitLab access token. Run /login gitlab-duo or set GITLAB_TOKEN",
      });
    }

    const cfg = MODEL_MAP.get(model.id);
    if (cfg === undefined) {
      return yield* new GitLabStreamError({ message: `Unknown model: ${model.id}` });
    }

    const directAccess = yield* getDirectAccessToken(gitlabAccessToken);
    const modelWithBaseUrl = { ...model, baseUrl: cfg.baseUrl };
    const headers = { ...directAccess.headers, Authorization: `Bearer ${directAccess.token}` };
    const streamOptions = { ...options, apiKey: "gitlab-duo", headers };

    const innerStream = openInnerStream(cfg.backend, modelWithBaseUrl, context, streamOptions);

    yield* Stream.runForEach(
      Stream.fromAsyncIterable(
        innerStream,
        (cause) => new GitLabStreamError({ message: String(cause) }),
      ),
      (event) => Effect.sync(() => stream.push(event)),
    );
    stream.end();
  });

const streamGitLabDuoImpl = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();

  Effect.runFork(
    Effect.gen(function* () {
      const timestamp = yield* Clock.currentTimeMillis;
      yield* runStream(stream, model, context, options).pipe(
        Effect.catch((error: GitLabStreamError | GitLabAuthError) =>
          Effect.sync(() => {
            stream.push(errorEvent(model, error.message, timestamp));
            stream.end();
          }),
        ),
      );
    }),
  );

  return stream;
};

export const streamGitLabDuo: {
  (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  (
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): (model: Model<Api>) => AssistantMessageEventStream;
} = dual((args: IArguments) => args.length >= 2, streamGitLabDuoImpl);
