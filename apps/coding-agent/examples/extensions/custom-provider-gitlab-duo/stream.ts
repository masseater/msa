import compatModule from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import { Clock, Data, Effect, Stream } from "effect";
import { dual } from "effect/Function";

import { GitLabAuthError, getDirectAccessToken } from "./auth.ts";
import { MODEL_MAP } from "./config.ts";

const { anthropicMessagesApi, createAssistantMessageEventStream, openAIResponsesApi } =
  compatModule;

class GitLabStreamError extends Data.TaggedError("GitLabStreamError")<{
  readonly message: string;
}> {}

const errorEvent = (
  model: compatTypes.Model<compatTypes.Api>,
  message: string,
  timestamp: number,
) => ({
  error: {
    api: model.api,
    content: [],
    errorMessage: message,
    model: model.id,
    provider: model.provider,
    role: "assistant" as const,
    stopReason: "error" as const,
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  },
  reason: "error" as const,
  type: "error" as const,
});

const openInnerStream = (
  backend: string,
  modelWithBaseUrl: compatTypes.Model<compatTypes.Api>,
  context: compatTypes.TranscriptContext,
  streamOptions: compatTypes.SimpleStreamOptions,
) => {
  if (backend === "anthropic") {
    const anthropicModel = modelWithBaseUrl as compatTypes.Model<"anthropic-messages">;
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
    modelWithBaseUrl as compatTypes.Model<"openai-responses">,
    context,
    streamOptions,
  );
};

const runStream = (
  stream: compatTypes.AssistantMessageEventStream,
  model: compatTypes.Model<compatTypes.Api>,
  context: compatTypes.TranscriptContext,
  options: compatTypes.SimpleStreamOptions | undefined,
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
  model: compatTypes.Model<compatTypes.Api>,
  context: compatTypes.TranscriptContext,
  options?: compatTypes.SimpleStreamOptions,
): compatTypes.AssistantMessageEventStream => {
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
    model: compatTypes.Model<compatTypes.Api>,
    context: compatTypes.TranscriptContext,
    options?: compatTypes.SimpleStreamOptions,
  ): compatTypes.AssistantMessageEventStream;
  (
    context: compatTypes.TranscriptContext,
    options?: compatTypes.SimpleStreamOptions,
  ): (model: compatTypes.Model<compatTypes.Api>) => compatTypes.AssistantMessageEventStream;
} = dual((args: IArguments) => args.length >= 2, streamGitLabDuoImpl);
