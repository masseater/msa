import type aiTypes from "@msa/ai/index.types";
import transcript from "@msa/ai/utils/transcript";
import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect, Exit, Function } from "effect";

import entriesModule from "../entries.ts";
import type promptTypes from "./prompt.types.ts";
import type typesModule from "./types.types.ts";

const { declarationsEqual, getCurrentTools, toToolDeclaration } = transcript;

const { SystemEntry } = entriesModule;

function replaySections(messages: readonly aiTypes.Message[]): Map<string, string> {
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

type RenderRequest<Tool extends typesModule.ToolRegistration> = {
  readonly input: typesModule.PromptInput<Tool>;
  readonly shown: ReadonlyMap<string, string>;
  readonly report: (error: unknown) => void;
  readonly context: chordTypes.Context;
};

const renderSection = <Tool extends typesModule.ToolRegistration>(
  section: typesModule.PromptSection<Tool>,
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

const renderSections: {
  <Tool extends typesModule.ToolRegistration>(
    input: typesModule.PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: chordTypes.Context,
  ): (sections: readonly typesModule.PromptSection<Tool>[]) => Effect.Effect<Map<string, string>>;
  <Tool extends typesModule.ToolRegistration>(
    sections: readonly typesModule.PromptSection<Tool>[],
    input: typesModule.PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: chordTypes.Context,
  ): Effect.Effect<Map<string, string>>;
} = Function.dual(
  5,
  Effect.fnUntraced(function* <Tool extends typesModule.ToolRegistration>(
    sections: readonly typesModule.PromptSection<Tool>[],
    input: typesModule.PromptInput<Tool>,
    shown: ReadonlyMap<string, string>,
    report: (error: unknown) => void,
    context: chordTypes.Context,
  ) {
    const desired = new Map<string, string>();
    const request = { context, input, report, shown };
    yield* Effect.forEach(sections, (section) => renderSection(section, request, desired), {
      discard: true,
    });
    return desired;
  }),
);

type ToolChanges = {
  readonly toolsRemoved: aiTypes.ToolReference[];
  readonly toolsAdded: aiTypes.Tool[];
};

const planSystemEntries: typesModule.Dual4<
  typesModule.ContextView,
  ReadonlyMap<string, string>,
  readonly aiTypes.Tool[],
  number,
  promptTypes.SystemDraft[]
> = Function.dual(4, planEntries);

function planEntries(
  view: typesModule.ContextView,
  desired: ReadonlyMap<string, string>,
  tools: readonly aiTypes.Tool[],
  timestamp: number,
): promptTypes.SystemDraft[] {
  const head = view.head;
  if (
    head !== undefined &&
    !view.entries.some((entry) => SystemEntry.is(entry) && entry.id > head.id)
  ) {
    const edits: typesModule.ContextEdit[] = view.entries
      .filter((entry) => SystemEntry.is(entry))
      .map((entry) => ({ action: "omit", target: entry.id }));
    const baseline = systemEntry(
      Object.fromEntries(desired),
      { toolsAdded: tools.map(toToolDeclaration), toolsRemoved: [] },
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

function planTools(
  offered: readonly aiTypes.Tool[],
  desired: readonly aiTypes.Tool[],
): ToolChanges {
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
      toolsAdded: desired.map(toToolDeclaration),
      toolsRemoved: offered.map((tool) => ({ name: tool.name })),
    };
  }
  return {
    toolsAdded: added.map(toToolDeclaration),
    toolsRemoved: offered
      .filter((tool) => !keptNames.has(tool.name))
      .map((tool) => ({ name: tool.name })),
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
): promptTypes.SystemDraft {
  const message: aiTypes.SystemMessage = {
    content: "",
    role: "system",
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

const prompt = {
  planSystemEntries,
  renderSections,
  replaySections,
};

export default prompt;
