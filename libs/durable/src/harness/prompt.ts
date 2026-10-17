import type { Message, SystemMessage, Tool as AiTool, ToolReference } from "@msa/ai";
import { declarationsEqual, getCurrentTools, toToolDeclaration } from "@msa/ai/utils/transcript";
import type { Context } from "@msa/chord";
import { Cause, Effect, Exit, Function } from "effect";

import { SystemEntry } from "../entries.ts";
import type {
  ContextEdit,
  ContextView,
  Dual4,
  PromptInput,
  PromptSection,
  ToolRegistration,
  TypedEntryDraft,
} from "./types.ts";

export function replaySections(messages: readonly Message[]): Map<string, string> {
  const shown = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "system" || message.sections === undefined) continue;
    for (const [key, value] of Object.entries(message.sections)) {
      if (value === null) shown.delete(key);
      else shown.set(key, value);
    }
  }
  return shown;
}

type RenderRequest<Tool extends ToolRegistration> = {
  readonly input: PromptInput<Tool>;
  readonly shown: ReadonlyMap<string, string>;
  readonly report: (error: unknown) => void;
  readonly context: Context;
};

const renderSection = <Tool extends ToolRegistration>(
  section: PromptSection<Tool>,
  request: RenderRequest<Tool>,
  desired: Map<string, string>,
) =>
  Effect.gen(function* () {
    const rendered = yield* Effect.exit(
      Effect.promise(() => Promise.resolve(section.render(request.input, request.context))),
    );
    if (Exit.isFailure(rendered)) {
      const error = Cause.squash(rendered.cause);
      if (request.context.abortSignal?.aborted === true) return yield* Effect.die(error);
      request.report(error);
      const kept = request.shown.get(section.key);
      if (kept !== undefined) desired.set(section.key, kept);
      return;
    }
    const text = rendered.value;
    if (text === undefined) return;
    desired.set(
      section.key,
      section.tag === false ? text : `<${section.key}>\n${text}\n</${section.key}>`,
    );
  });

export const renderSections: {
  <Tool extends ToolRegistration>(
    input: PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: Context,
  ): (sections: readonly PromptSection<Tool>[]) => Effect.Effect<Map<string, string>>;
  <Tool extends ToolRegistration>(
    sections: readonly PromptSection<Tool>[],
    input: PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: Context,
  ): Effect.Effect<Map<string, string>>;
} = Function.dual(
  5,
  Effect.fn("renderSections")(function* <Tool extends ToolRegistration>(
    sections: readonly PromptSection<Tool>[],
    input: PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: Context,
  ) {
    const desired = new Map<string, string>();
    const request = { input, shown, report, context };
    yield* Effect.forEach(sections, (section) => renderSection(section, request, desired), {
      discard: true,
    });
    return desired;
  }),
);

export type SystemDraft = TypedEntryDraft<never>;

type ToolChanges = { readonly toolsRemoved: ToolReference[]; readonly toolsAdded: AiTool[] };

export const planSystemEntries: Dual4<
  ContextView,
  ReadonlyMap<string, string>,
  readonly AiTool[],
  number,
  SystemDraft[]
> = Function.dual(4, planEntries);

function planEntries(
  view: ContextView,
  desired: ReadonlyMap<string, string>,
  tools: readonly AiTool[],
  timestamp: number,
): SystemDraft[] {
  const head = view.head;
  if (
    head !== undefined &&
    !view.entries.some((entry) => SystemEntry.is(entry) && entry.id > head.id)
  ) {
    const edits: ContextEdit[] = view.entries
      .filter((entry) => SystemEntry.is(entry))
      .map((entry) => ({ target: entry.id, action: "omit" }));
    const baseline = systemEntry(
      Object.fromEntries(desired),
      { toolsRemoved: [], toolsAdded: tools.map(toToolDeclaration) },
      timestamp,
    );
    return [edits.length === 0 ? baseline : { ...baseline, edits }];
  }
  const sections = planSections(replaySections(view.messages), desired);
  const changes = planTools(getCurrentTools(view.messages), tools);
  if (changes.toolsRemoved.length === 0 && changes.toolsAdded.length === 0) {
    return sections.map((patch) => systemEntry(patch, undefined, timestamp));
  }
  if (sections.length === 0) return [systemEntry(undefined, changes, timestamp)];
  return sections.map((patch, index) =>
    systemEntry(patch, index === sections.length - 1 ? changes : undefined, timestamp),
  );
}

function planTools(offered: readonly AiTool[], desired: readonly AiTool[]): ToolChanges {
  const wanted = new Map(desired.map((tool) => [tool.name, tool]));
  const kept = offered.filter((tool) => {
    const next = wanted.get(tool.name);
    return next !== undefined && declarationsEqual(tool, next);
  });
  const keptNames = new Set(kept.map((tool) => tool.name));
  const added = desired.filter((tool) => !keptNames.has(tool.name));
  const replayed = [...kept, ...added];
  if (replayed.some((tool, index) => tool.name !== desired[index]!.name)) {
    return {
      toolsRemoved: offered.map((tool) => ({ name: tool.name })),
      toolsAdded: desired.map(toToolDeclaration),
    };
  }
  return {
    toolsRemoved: offered
      .filter((tool) => !keptNames.has(tool.name))
      .map((tool) => ({ name: tool.name })),
    toolsAdded: added.map(toToolDeclaration),
  };
}

function planSections(
  shown: ReadonlyMap<string, string>,
  desired: ReadonlyMap<string, string>,
): Record<string, string | null>[] {
  const patchedOrder = [
    ...[...shown.keys()].filter((key) => desired.has(key)),
    ...[...desired.keys()].filter((key) => !shown.has(key)),
  ];
  const desiredOrder = [...desired.keys()];
  if (patchedOrder.some((key, index) => key !== desiredOrder[index])) {
    return [
      Object.fromEntries([...shown.keys()].map((key) => [key, null])),
      Object.fromEntries(desired),
    ];
  }

  const patch: Record<string, string | null> = {};
  for (const [key, value] of shown) {
    const next = desired.get(key);
    if (next !== value) patch[key] = next ?? null;
  }
  for (const [key, value] of desired) if (!shown.has(key)) patch[key] = value;
  return Object.keys(patch).length === 0 ? [] : [patch];
}

function systemEntry(
  sections: Record<string, string | null> | undefined,
  tools: ToolChanges | undefined,
  timestamp: number,
): SystemDraft {
  const message: SystemMessage = {
    role: "system",
    content: "",
    ...(sections === undefined ? {} : { sections }),
    ...(tools === undefined || tools.toolsRemoved.length === 0
      ? {}
      : { toolsRemoved: tools.toolsRemoved }),
    ...(tools === undefined || tools.toolsAdded.length === 0
      ? {}
      : { toolsAdded: tools.toolsAdded }),
    timestamp,
  };
  return { model: [message] };
}
