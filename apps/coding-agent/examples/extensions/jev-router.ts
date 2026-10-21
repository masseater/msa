import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

const PROVIDER = "openai-codex";
const SOL = "gpt-5.6-sol";
const TERRA = "gpt-5.6-terra";
const LUNA = "gpt-5.6-luna";

const EDIT_TOOLS = new Set(["edit", "write"]);

interface JevState {
  phase: "planning" | "implementation";

  model: string;
}

type JevRequest = codingAgentTypes.ModelRouteRequest<JevState>;

function routeTo(
  request: JevRequest,
  ctx: codingAgentTypes.ExtensionContext,
  id: string,
  state?: JevState,
): codingAgentTypes.ModelRoute<JevState> {
  const model = ctx.modelRegistry.find(PROVIDER, id);
  if (model === undefined) throw new Error(`Model ${PROVIDER}/${id} is not in the catalog`);
  return {
    model,
    thinkingLevel: request.thinkingLevel,
    ...(state === undefined ? {} : { state }),
  };
}

function lastUserText(messages: readonly aiTypes.Message[]): string {
  const content = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function editedThisTurn(messages: readonly aiTypes.Message[]): boolean {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  return messages
    .slice(lastUser + 1)
    .some(
      (message) =>
        message.role === "toolResult" && EDIT_TOOLS.has(message.toolName) && !message.isError,
    );
}

const choosePlanningModel = (request: JevRequest, ctx: codingAgentTypes.ExtensionContext) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const previous = request.previous?.model;
      if (previous?.provider === PROVIDER && (previous.id === SOL || previous.id === TERRA))
        return previous.id;

      const jev = ctx.modelRegistry.findOfType("classifier", "openrouter", "~typesafe/jev-latest");
      if (jev === undefined) return TERRA;
      const result = yield* Effect.promise(() =>
        ctx.modelRegistry.classify(
          jev,
          {
            questions: {
              complexity: {
                criteria: {
                  complex: "Subtle design, cross-cutting changes, or hard debugging",
                  standard: "Ordinary features, fixes, reviews, or questions",
                },
                instructions:
                  "How demanding is the software engineering work requested in `prompt`?",
                type: "choice",
              },
            },
            state: { prompt: lastUserText(request.messages).slice(0, 16_000) },
          },
          { signal: request.signal },
        ),
      );
      const answer = result.stopReason === "stop" ? result.answers["complexity"] : undefined;
      return answer?.type === "choice" && (answer.probabilities["complex"] ?? 0) >= 0.5
        ? SOL
        : TERRA;
    }),
  );

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerVirtualModel<JevState>({
    contextWindow: 272_000,
    id: "auto",
    maxTokens: 128_000,
    name: "Auto (Jev)",
    provider: "jev",
    route: (request, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (request.reason === "direct") return routeTo(request, ctx, LUNA);
          const state = request.state;
          if (state === undefined) {
            const model = yield* Effect.promise(() => choosePlanningModel(request, ctx));
            return routeTo(request, ctx, model, { model, phase: "planning" });
          }

          if (state.phase === "planning" && editedThisTurn(request.messages)) {
            return routeTo(request, ctx, LUNA, { model: LUNA, phase: "implementation" });
          }
          return routeTo(request, ctx, state.model);
        }),
      ),
    thinkingLevels: ["low", "medium", "high", "xhigh"],
  });
}
