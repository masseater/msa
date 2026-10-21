import modelSchema from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";
import resourceSchemas from "./resource-schemas.ts";
import sectionSchemas from "./section-schemas.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { ModelThinkingLevelSchema } = modelSchema;
const {
  BranchSummarySettingsSchema,
  CodemodeSettingsSchema,
  CompactionSettingsSchema,
  MemorySettingsSchema,
} = sectionSchemas;
const { PrWatchSettingsSchema } = resourceSchemas;

const sessionProperties = {
  branchSummary: Type.Optional(BranchSummarySettingsSchema),
  codemode: Type.Optional(CodemodeSettingsSchema),
  compaction: Type.Optional(CompactionSettingsSchema),
  defaultProjectTrust: Type.Optional(
    Type.Union([Type.Literal("ask"), Type.Literal("always"), Type.Literal("never")], {
      default: SETTINGS_DEFAULTS.defaultProjectTrust,
      description: "Global setting only.",
    }),
  ),
  followUpMode: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
      default: SETTINGS_DEFAULTS.followUpMode,
    }),
  ),
  goal: Type.Optional(
    Type.Object({
      evaluatorModel: Type.Optional(
        Type.String({
          description:
            'Model that judges /goal conditions, as "provider/id". Default: the strongest small model (haiku, flash, mini, lite, small) of the working model\'s provider, or the working model.',
        }),
      ),
    }),
  ),
  memory: Type.Optional(MemorySettingsSchema),
  orchestrator: Type.Optional(
    Type.Object({
      database: Type.Optional(
        Type.String({
          description:
            "SQLite file holding tasks, threads, reports, and notes. Default: <agent dir>/orchestrator.db.",
        }),
      ),
      maxConcurrentThreads: Type.Optional(
        Type.Integer({
          default: SETTINGS_DEFAULTS.orchestrator.maxConcurrentThreads,
          minimum: 1,
        }),
      ),
      reviewModel: Type.Optional(
        Type.String({
          description:
            'Model of the review thread that closes each round, as "provider/id". Default: the orchestrator\'s model.',
        }),
      ),
      reviewThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
      workerModel: Type.Optional(
        Type.String({
          description:
            'Model of the threads the orchestrator starts, as "provider/id", unless create_task names one. Default: the orchestrator\'s model.',
        }),
      ),
      workerThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
    }),
  ),
  prWatch: Type.Optional(PrWatchSettingsSchema),
  queueMode: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
      deprecated: true,
      description: "Legacy setting migrated to steeringMode.",
    }),
  ),
  sessionDir: Type.Optional(
    Type.String({
      description:
        "Custom session storage directory, in the same format as the --session-dir CLI flag.",
    }),
  ),
  shellCommandPrefix: Type.Optional(
    Type.String({
      description: "Prefix prepended to every bash command, for example to enable shell aliases.",
    }),
  ),
  shellPath: Type.Optional(
    Type.String({
      description:
        "Custom shell path, for example for Cygwin on Windows, with support for leading ~ expansion.",
    }),
  ),
  steeringMode: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")], {
      default: SETTINGS_DEFAULTS.steeringMode,
    }),
  ),
};

export default sessionProperties;
