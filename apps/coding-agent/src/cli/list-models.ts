import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";
import chalk from "chalk";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import authGuidance from "../core/auth-guidance.ts";
import awaitingModule from "../core/awaiting.ts";
import modelPolicy from "../core/model-policy.ts";
import type ModelRuntime from "../core/model-runtime.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import platform from "../core/platform.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platform;
const { formatNoModelsAvailableMessage } = authGuidance;
const { hiddenModelsByPolicy } = modelPolicy;

const { fuzzyFilter } = tui;

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const thousands = count / 1_000;
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }
  return count.toString();
}

function listModelsImpl(
  modelRuntime: modelRuntimeTypes.ModelRuntime,
  searchPattern?: string,
  signal?: AbortSignal,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      const models = yield* loadAvailableModels(modelRuntime, signal);

      if (models.length === 0) {
        writeLog(formatNoModelsAvailableMessage());
        return;
      }

      let filteredModels: aiTypes.Model<aiTypes.Api>[] = models;
      if (searchPattern !== undefined && searchPattern !== "") {
        filteredModels = fuzzyFilter(models, searchPattern, (m) => `${m.provider} ${m.id}`);
      }

      if (filteredModels.length === 0) {
        writeLog(`No models matching "${searchPattern}"`);
        return;
      }

      filteredModels.sort((a, b) => {
        const providerCmp = a.provider.localeCompare(b.provider);
        if (providerCmp !== 0) return providerCmp;
        return a.id.localeCompare(b.id);
      });

      const rows = filteredModels.map((m) => ({
        context: formatTokenCount(m.contextWindow),
        images: m.input.includes("image") ? "yes" : "no",
        maxOut: formatTokenCount(m.maxTokens),
        model: m.id,
        provider: m.provider,
        thinking: m.reasoning ? "yes" : "no",
      }));

      printModelTable(rows);

      const policy = modelRuntime.getModelPolicy();
      const hidden = hiddenModelsByPolicy(policy, modelRuntime.getCatalogModels());
      if (hidden.length === 0) return;
      const patterns = [
        ...new Set(hidden.map((entry) => (entry.pattern === "" ? "allow list" : entry.pattern))),
      ];
      writeLog(
        chalk.dim(
          `\n${hidden.length} model${hidden.length === 1 ? "" : "s"} hidden by model policy (${patterns.join(", ")}). See /model.`,
        ),
      );
    }),
  );
}

const listModels: {
  (
    modelRuntime: modelRuntimeTypes.ModelRuntime,
    searchPattern?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  (
    searchPattern?: string,
    signal?: AbortSignal,
  ): (modelRuntime: modelRuntimeTypes.ModelRuntime) => Promise<void>;
} = dual((args: IArguments) => args.length >= 1, listModelsImpl);

const listModelsModule = {
  listModels,
};

export default listModelsModule;

function* loadAvailableModels(modelRuntime: ModelRuntime, signal: AbortSignal | undefined) {
  const loadError = modelRuntime.getError();
  if (loadError !== undefined && loadError !== "") {
    writeError(chalk.yellow(`Warning: errors loading models.json:\n${loadError}`));
  }

  const models = [
    ...(yield* awaited(
      modelRuntime.getAvailable(undefined, signal === undefined ? {} : { signal }),
    )),
  ];
  return models;
}

function printModelTable(
  rows: {
    context: string;
    images: string;
    maxOut: string;
    model: string;
    provider: string;
    thinking: string;
  }[],
) {
  const headers = {
    context: "context",
    images: "images",
    maxOut: "max-out",
    model: "model",
    provider: "provider",
    thinking: "thinking",
  };

  const widths = {
    context: Math.max(headers.context.length, ...rows.map((r) => r.context.length)),
    images: Math.max(headers.images.length, ...rows.map((r) => r.images.length)),
    maxOut: Math.max(headers.maxOut.length, ...rows.map((r) => r.maxOut.length)),
    model: Math.max(headers.model.length, ...rows.map((r) => r.model.length)),
    provider: Math.max(headers.provider.length, ...rows.map((r) => r.provider.length)),
    thinking: Math.max(headers.thinking.length, ...rows.map((r) => r.thinking.length)),
  };

  const headerLine = [
    headers.provider.padEnd(widths.provider),
    headers.model.padEnd(widths.model),
    headers.context.padEnd(widths.context),
    headers.maxOut.padEnd(widths.maxOut),
    headers.thinking.padEnd(widths.thinking),
    headers.images.padEnd(widths.images),
  ].join("  ");
  writeLog(headerLine);

  for (const row of rows) {
    const line = [
      row.provider.padEnd(widths.provider),
      row.model.padEnd(widths.model),
      row.context.padEnd(widths.context),
      row.maxOut.padEnd(widths.maxOut),
      row.thinking.padEnd(widths.thinking),
      row.images.padEnd(widths.images),
    ].join("  ");
    writeLog(line);
  }
}
