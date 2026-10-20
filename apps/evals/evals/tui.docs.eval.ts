import type aiTypes from "@msa/ai/index.types";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Levenshtein } from "autoevals";
import { Clock, Effect } from "effect";
import { createJudge, describeEval } from "vitest-evals";

import type harnessTypesTypes from "../src/harness-types.ts";
import harnessModule from "../src/harness.ts";
import RecordingTerminal from "./recording-terminal.ts";
import type recordingTerminalTypes from "./recording-terminal.types.ts";

const { AgentSessionRuntime, InteractiveMode, SessionManager, createAgentSessionFromServices } =
  codingAgent;
const { createMsaDocumentationEvalHarness } = harnessModule;

const CONTEXT_WINDOW = 272_000;
const BUILT_IN_CONTEXT_PATTERN = /\d+(?:\.\d+)?%\/272k(?: \(auto\))?/u;
const CONTEXT_FIXTURES = [
  { expectedBar: "████░░░░░░ 42%", percent: 42.2 },
  { expectedBar: "███████░░░ 65%", percent: 65 },
  { expectedBar: "██████████ 100%", percent: 120 },
] as const;

type TuiFooterOutput = {
  builtInStatusLine: string | null;
  observations: Array<{
    percent: number;
    renderedOutput: string;
    contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null;
  }>;
  extensionErrors: string[];
};

function lines(output: string): string[] {
  return output.split(/[\r\n]+/u).filter((line) => line.trim().length > 0);
}

function normalizeWhitespace(text: string): string {
  return text.trim().replaceAll(/\s+/gu, " ");
}

function createContextMessage(
  model: NonNullable<codingAgentTypes.AgentSession["model"]>,
  percent: number,
  timestamp: number,
): aiTypes.AssistantMessage {
  const tokens = Math.round((model.contextWindow * percent) / 100);
  return {
    api: model.api,
    content: [{ text: "Context usage fixture", type: "text" }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: tokens,
      output: 0,
      totalTokens: tokens,
    },
  };
}

const createOracleRuntime = (
  session: codingAgentTypes.AgentSession,
  agentDir: string,
  model: NonNullable<codingAgentTypes.AgentSession["model"]>,
) =>
  Effect.gen(function* () {
    const services: codingAgentTypes.AgentSessionServices = {
      agentDir,
      cwd: session.sessionManager.getCwd(),
      diagnostics: [],
      modelRuntime: session.modelRuntime,
      resourceLoader: session.resourceLoader,
      settingsManager: session.settingsManager,
    };
    const { session: oracleSession } = yield* Effect.promise(() =>
      createAgentSessionFromServices({
        model,
        noTools: "all",
        services,
        sessionManager: SessionManager.inMemory(services.cwd),
        thinkingLevel: "high",
      }),
    );
    const runtime = new AgentSessionRuntime(oracleSession, services, () =>
      Promise.reject(new Error("The TUI footer oracle does not replace sessions.")),
    );
    return { oracleSession, runtime };
  });

const observeFooter = (
  session: codingAgentTypes.AgentSession,
  oracleSession: codingAgentTypes.AgentSession,
  model: NonNullable<codingAgentTypes.AgentSession["model"]>,
  mode: codingAgentTypes.InteractiveMode,
  terminal: recordingTerminalTypes.RecordingTerminal,
): Effect.Effect<TuiFooterOutput> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    oracleSession.sessionManager.appendMessage({
      ...createContextMessage(model, 0, now),
      usage: {
        cacheRead: 606_000,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 1.008, output: 0, total: 1.008 },
        input: 106_000,
        output: 5_800,
        totalTokens: 717_800,
      },
    });
    let builtInStatusLine: string | null = null;
    const observations: TuiFooterOutput["observations"] = [];
    for (const [index, { percent }] of CONTEXT_FIXTURES.entries()) {
      oracleSession.agent.state.messages = [createContextMessage(model, percent, now)];
      if (index === 0) yield* Effect.promise(() => mode.init());
      else terminal.requestResize();
      const renders = yield* terminal.takeRenders();
      if (index === 0) {
        builtInStatusLine =
          renders.flatMap(lines).find((line) => BUILT_IN_CONTEXT_PATTERN.test(line)) ?? null;
      }
      observations.push({
        contextUsage: oracleSession.getContextUsage() ?? null,
        percent,
        renderedOutput: renders.at(-1) ?? "",
      });
    }
    return {
      builtInStatusLine,
      extensionErrors: session.resourceLoader.getExtensions().errors.map(({ error }) => error),
      observations,
    };
  });

const inspectContextFooter = (
  session: codingAgentTypes.AgentSession,
  agentDir: string,
): Effect.Effect<TuiFooterOutput> =>
  Effect.gen(function* () {
    const activeModel = session.model;
    if (activeModel === undefined) {
      return yield* Effect.die(new Error("TUI footer oracle requires an active model."));
    }
    const model = { ...activeModel, contextWindow: CONTEXT_WINDOW };
    const { oracleSession, runtime } = yield* createOracleRuntime(session, agentDir, model);
    const terminal = new RecordingTerminal();
    const mode = new InteractiveMode(runtime, { terminal, tuiMode: "regular" });
    const disposeRuntime = Effect.promise(() => runtime.dispose());
    return yield* observeFooter(session, oracleSession, model, mode, terminal).pipe(
      Effect.ensuring(
        Effect.sync(() => mode.stop("resume-hint")).pipe(Effect.ensuring(disposeRuntime)),
      ),
    );
  });

const harness = createMsaDocumentationEvalHarness({
  output: ({ session, agentDir }) => inspectContextFooter(session, agentDir),
});

type FixtureCheck = { valid: boolean; similarity: number | undefined };

const checkFixture = (
  output: TuiFooterOutput,
  index: number,
  fixture: (typeof CONTEXT_FIXTURES)[number],
  reference: string | undefined,
): Effect.Effect<FixtureCheck> =>
  Effect.gen(function* () {
    const { percent, expectedBar } = fixture;
    const invalid: FixtureCheck = { similarity: undefined, valid: false };
    const observation = output.observations[index];
    if (observation === undefined || observation.percent !== percent) return invalid;
    let valid =
      observation.contextUsage?.contextWindow === CONTEXT_WINDOW &&
      Math.round((observation.contextUsage?.percent ?? -1) * 10) / 10 === percent;
    const actualStatusLine = lines(observation.renderedOutput).find(
      (line) => line.includes(expectedBar) || BUILT_IN_CONTEXT_PATTERN.test(line),
    );
    if (actualStatusLine === undefined) return invalid;
    const normalized = normalizeWhitespace(actualStatusLine);
    if (!normalized.includes(expectedBar) || BUILT_IN_CONTEXT_PATTERN.test(normalized)) {
      return invalid;
    }
    for (const { expectedBar: otherBar } of CONTEXT_FIXTURES) {
      if (otherBar !== expectedBar && normalized.includes(otherBar)) valid = false;
    }
    if (reference === undefined) return { similarity: undefined, valid };
    const result = yield* Effect.promise(() =>
      Promise.resolve(
        Levenshtein({ expected: reference, output: normalized.replace(expectedBar, "{context}") }),
      ),
    );
    return { similarity: result.score ?? undefined, valid };
  });

const judgeFooter = (output: TuiFooterOutput) =>
  Effect.gen(function* () {
    const contextMarker = "{context}";
    const builtInStatusLine = output.builtInStatusLine;
    const reference =
      builtInStatusLine === null
        ? undefined
        : normalizeWhitespace(builtInStatusLine).replace(BUILT_IN_CONTEXT_PATTERN, contextMarker);
    let valid =
      output.extensionErrors.length === 0 &&
      reference !== undefined &&
      reference.includes(contextMarker);
    const similarities: number[] = [];
    for (const [index, fixture] of CONTEXT_FIXTURES.entries()) {
      const check = yield* checkFixture(output, index, fixture, reference);
      valid = valid && check.valid;
      if (check.similarity !== undefined) similarities.push(check.similarity);
    }
    const retained =
      similarities.length === CONTEXT_FIXTURES.length ? Math.min(...similarities) : 0;
    return {
      metadata: {
        rationale: valid
          ? `Footer retained ${Math.round(retained * 100)}% of the built-in status text.`
          : "Context progress behavior was incorrect.",
        retainedPercent: Math.round(retained * 100),
      },
      score: valid ? 1 : 0,
    };
  });

const contextFooterJudge = createJudge<harnessTypesTypes.MsaCodingAgentInput, TuiFooterOutput>(
  "ContextFooterJudge",
  ({ output }) => Effect.runPromise(judgeFooter(output)),
);

describeEval(
  "Customize the interactive context footer",
  { harness, judgeThreshold: null, judges: [contextFooterJudge] },
  (it) => {
    it("replaces numeric context usage with a progress bar", ({ run }) =>
      run([
        {
          content:
            "Change the msa footer replacing the built-in context info, e.g. `42.2%/272k (auto)`, with a ten-cell progress bar to make it show ████░░░░░░ 42% instead. Clamp percentages to the 0-100 range. Just replace the context. Otherwise leave everything else the same.",
          type: "prompt",
        },
        { type: "reload" },
      ]));
  },
);
