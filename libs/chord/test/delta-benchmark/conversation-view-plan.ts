import type { Draft } from "../../src/delta/draft.ts";
import { payloadText } from "./conversation-view-content.ts";
import type { Scenario } from "./conversation-view-model.ts";
import type {
  AuditDoc,
  CommitPlan,
  ConfigDoc,
  DocMutation,
  DocumentKey,
  InboxDoc,
  JsonDraft,
  LiveDoc,
  PreferencesDoc,
  TurnDoc,
} from "./conversation-view-types.ts";

const on = <T>(key: DocumentKey, mutate: (doc: Draft<T>) => void): DocMutation => ({
  key,
  mutate: (draft: JsonDraft) => mutate(draft as unknown as Draft<T>),
});

const streamChunk = (index: number): DocMutation[] => [
  on<LiveDoc>("live", (live) => {
    const limit = 4_096 + (index % 8) * 4_096;
    const chunk = payloadText(384 + (index % 5) * 64, 100_000 + index);
    live.generation.partial = `${live.generation.partial}${chunk}`.slice(-limit);
    live.generation.stage = "streaming";
    live.status = "streaming";
    live.tokens += 24 + (index % 17);
    live.cost += 0.0002;
    live.heartbeat = index;
  }),
];

const toolProgress = (index: number, cycle: number): DocMutation[] => [
  on<LiveDoc>("live", (live) => {
    const slot = live.tools[index % live.tools.length]!;
    slot.status = cycle % 4 === 0 ? "completed" : "running";
    slot.progress = Math.min(1, slot.progress + 0.125);
    slot.output = `${slot.output.slice(-2_048)}${payloadText(512, 110_000 + index)}`;
    live.heartbeat = index;
  }),
];

const inboxPush = (index: number, cycle: number): DocMutation[] => [
  on<InboxDoc>("inbox", (inbox) => {
    inbox.items.push({
      id: 1_000_000 + index,
      mode: cycle % 2 === 0 ? "steer" : "followUp",
      text: payloadText(1_024, 120_000 + index),
    });
    if (inbox.items.length > 20) inbox.items.shift();
    inbox.revision += 1;
  }),
];

const settlement = (index: number, cycle: number): DocMutation[] => [
  on<LiveDoc>("live", (live) => {
    live.status = cycle === 94 ? "admitting" : "ready";
    live.generation.stage = cycle === 94 ? "requesting" : "completed";
    live.heartbeat = index;
  }),
  on<TurnDoc>("turn", (turn) => {
    turn.stage = cycle === 94 ? "requesting" : "idle";
    turn.message = cycle === 94 ? payloadText(720, 130_000 + index) : "";
    turn.revision += 1;
  }),
];

const configEdit = (index: number): DocMutation[] => [
  on<ConfigDoc>("config", (configDoc) => {
    configDoc.thinkingLevel = index % 200 === 96 ? "high" : "medium";
    configDoc.temperature = 0.15 + (Math.floor(index / 100) % 4) * 0.05;
    const section = configDoc.sections[Math.floor(index / 100) % configDoc.sections.length]!;
    section.instructions = payloadText(section.instructions.length, 140_000 + index);
    configDoc.revision += 1;
  }),
];

const turnStage = (stage: string): DocMutation =>
  on<TurnDoc>("turn", (turn) => {
    turn.stage = stage;
    turn.revision += 1;
  });

const preferencesEdit = (index: number): DocMutation[] => [
  on<PreferencesDoc>("preferences", (preferences) => {
    preferences.theme = index % 200 === 97 ? "dim" : "dark";
    preferences.compactTools = !preferences.compactTools;
    preferences.editorProfile = payloadText(2_400 + (index % 4) * 256, 150_000 + index);
    preferences.revision += 1;
  }),
  turnStage("configured"),
];

const retry = (index: number): DocMutation[] => [
  on<LiveDoc>("live", (live) => {
    live.status = "retrying";
    live.generation.stage = "retrying";
    live.generation.attempt += 1;
    live.generation.retryAt = 1_700_000_000_000 + index * 100;
    live.heartbeat = index;
  }),
  turnStage("retrying"),
];

const unmountedOnly = (index: number): DocMutation[] => [
  on<AuditDoc>("audit", (audit) => {
    audit.commits += 1;
    audit.note = `unmounted-${index}`;
  }),
  on<ConfigDoc>("config", (configDoc) => {
    configDoc.model = { provider: configDoc.model.provider, modelId: configDoc.model.modelId };
  }),
];

const mountedMutations = (index: number, cycle: number): DocMutation[] => {
  if (cycle < 70) return streamChunk(index);
  if (cycle < 90) return toolProgress(index, cycle);
  if (cycle < 94) return inboxPush(index, cycle);
  if (cycle < 96) return settlement(index, cycle);
  if (cycle === 96) return configEdit(index);
  if (cycle === 97) return preferencesEdit(index);
  return retry(index);
};

export interface CommitRequest {
  readonly index: number;
  readonly scenario: Scenario;
}

export const planCommit = ({ index, scenario }: CommitRequest): CommitPlan => {
  const cycle = index % 100;
  if (cycle === 99) {
    return { docs: unmountedOnly(index), unmountedOnly: true, expectedConversationNoop: true };
  }
  const settles = cycle === 94 || cycle === 95;
  return {
    docs: mountedMutations(index, cycle),
    entryKind: settles ? (cycle === 94 ? "user" : "assistant") : undefined,
    branch: scenario === "branch-head-replacement" && cycle === 95 && index >= 100,
    unmountedOnly: false,
    expectedConversationNoop: false,
  };
};
