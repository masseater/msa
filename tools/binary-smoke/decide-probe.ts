import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, ManagedRuntime, Schedule, Schema } from "effect";

const CLASSIFIER = { id: "decide-probe", provider: "local" } as const;
const PROBE_PROMPT = "decide-probe: create the probe task";
const PROBE_RESULT_FILE = "decide-probe.json";
const FIXTURE = ["..", "..", "libs", "ai", "test", "fixtures", "stories260K.gguf"];
const VERDICT_POLLS = 600;
const REVIEWER_OPENING = "You are reviewing work another thread just did";
const VERDICT = /Review verdict: (?:pass|fail|undecided) \([^\n]*?\)\./u;

import scriptOutput from "../../libs/ai/src/utils/script-output.ts";

const { ScriptOutput } = scriptOutput;

const runtime = ManagedRuntime.make(scriptOutput.scriptOutputLayer);

const EMPTY: aiTypes.Message = { content: "", role: "user", timestamp: 0 };

const textOf = (message: aiTypes.Message): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

const firstUserText = (context: aiTypes.TranscriptContext): string =>
  textOf(context.messages.find((message) => message.role === "user") ?? EMPTY);

const resultFile = Effect.gen(function* () {
  const { path } = yield* scriptOutput.ScriptOutput;
  return path.resolve(PROBE_RESULT_FILE);
});

const writeVerdict = (verdict: string) =>
  Effect.gen(function* () {
    yield* (yield* ScriptOutput).writeTextFile(
      yield* resultFile,
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({ verdict }),
    );
  });

const verdictWritten = Effect.gen(function* () {
  const { files: fs } = yield* scriptOutput.ScriptOutput;
  yield* fs.exists(yield* resultFile).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("500 millis"),
      times: VERDICT_POLLS,
      until: (exists) => exists,
    }),
  );
});

const lastText = (context: aiTypes.TranscriptContext): string =>
  textOf(context.messages.at(-1) ?? EMPTY);

const createProbeTask = () =>
  ai.fauxAssistantMessage(
    ai.fauxToolCall("create_task", {
      currentState: "probe.txt does not exist.",
      dependsOn: [],
      goalState: "probe.txt exists and holds the agreed text.",
      title: "decide probe",
    }),
    { stopReason: "toolUse" },
  );

const mainReply = (context: aiTypes.TranscriptContext): aiTypes.AssistantMessage => {
  const verdict = VERDICT.exec(lastText(context));
  if (verdict !== null) {
    runtime.runFork(writeVerdict(verdict[0]));
    return ai.fauxAssistantMessage("Noted.");
  }
  return context.messages.some((message) => message.role === "toolResult")
    ? ai.fauxAssistantMessage("Waiting for the review.")
    : createProbeTask();
};

const recordGoalItems = () =>
  ai.fauxAssistantMessage(
    ai.fauxToolCall("record_goal_items", {
      findings: [],
      items: [{ evidence: "probe.txt holds the agreed text.", item: 1, status: "met" }],
    }),
    { stopReason: "toolUse" },
  );

const reviewerReply = (context: aiTypes.TranscriptContext) =>
  context.messages.at(-1)?.role === "toolResult"
    ? ai.fauxAssistantMessage(
        "The probe task's goal is met: probe.txt exists and holds the agreed text. No problem remains.",
      )
    : recordGoalItems();

const reply = (context: aiTypes.TranscriptContext): aiTypes.AssistantMessage => {
  const opening = firstUserText(context);
  if (opening === PROBE_PROMPT) return mainReply(context);
  return opening.includes(REVIEWER_OPENING)
    ? reviewerReply(context)
    : ai.fauxAssistantMessage("Done.");
};

const decideProbe = (msa: codingAgentTypes.ExtensionAPI) => {
  const fixture = runtime.runSync(
    Effect.gen(function* () {
      const { path } = yield* scriptOutput.ScriptOutput;
      return path.join(import.meta.dirname, ...FIXTURE);
    }),
  );
  msa.registerProvider(CLASSIFIER.provider, {
    models: [
      {
        api: "node-llama-cpp-classify",
        baseUrl: fixture,
        contextWindow: 4096,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: CLASSIFIER.id,
        input: ["text"],
        name: "Decide probe",
        type: "classifier",
      },
    ],
  });
  const scripted = ai.fauxProvider({
    api: "decide-probe-faux",
    models: [{ id: "scripted" }],
    provider: "probe",
  });
  const respond: aiTypes.FauxResponseFactory = (context) => {
    scripted.appendResponses([respond]);
    return reply(context);
  };
  scripted.setResponses([respond]);
  msa.registerProvider(scripted.provider);
  msa.on("session_shutdown", () => runtime.runPromise(verdictWritten));
};

export default decideProbe;
