import modelSchema from "@msa/ai/providers/model-schema";
import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";
import resourceSchemas from "./resource-schemas.ts";
import sectionSchemas from "./section-schemas.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { ModelThinkingLevelSchema } = modelSchema;
const { RetrySettingsSchema, thinkingBudgetsSettings, timeoutSetting } = sectionSchemas;
const { ModelPolicySettingsSchema } = resourceSchemas;

const modelProperties = {
  cacheWarming: Type.Optional(
    Type.Union([Type.Literal("off"), Type.Literal("streaming"), Type.Literal("idle")], {
      default: SETTINGS_DEFAULTS.cacheWarming,
      description:
        'Cache-warming profile. "idle" also warms between agent runs. Global only because each refresh costs money.',
    }),
  ),
  defaultModel: Type.Optional(Type.String()),
  defaultProvider: Type.Optional(Type.String()),
  defaultThinkingLevel: Type.Optional(ModelThinkingLevelSchema),
  enabledModels: Type.Optional(
    Type.Array(Type.String(), {
      description: "Model patterns for cycling, in the same format as the --models CLI flag.",
    }),
  ),
  httpIdleTimeoutMs: Type.Optional(
    timeoutSetting({
      description: 'HTTP header or body idle timeout in milliseconds; 0 or "disabled" disables it.',
    }),
  ),
  httpProxy: Type.Optional(
    Type.String({
      description: "Proxy URL applied as HTTP_PROXY and HTTPS_PROXY for msa-managed HTTP clients.",
    }),
  ),
  modelPolicy: Type.Optional(ModelPolicySettingsSchema),
  modelThinkingLevels: Type.Optional(
    Type.Record(Type.String(), ModelThinkingLevelSchema, {
      description: 'Per-model default thinking level overrides keyed by "provider/modelId".',
    }),
  ),
  retry: Type.Optional(RetrySettingsSchema),
  thinkingBudgets: Type.Optional(
    thinkingBudgetsSettings({
      description: "Custom token budgets for thinking levels.",
    }),
  ),
  transport: Type.Optional(
    Type.Union(
      [
        Type.Literal("auto"),
        Type.Literal("sse"),
        Type.Literal("websocket"),
        Type.Literal("websocket-cached"),
      ],
      { default: SETTINGS_DEFAULTS.transport },
    ),
  ),
  websocketConnectTimeoutMs: Type.Optional(
    timeoutSetting({
      description:
        'WebSocket connect or open handshake timeout in milliseconds; 0 or "disabled" disables it.',
    }),
  ),
  websockets: Type.Optional(
    Type.Boolean({ deprecated: true, description: "Legacy setting migrated to transport." }),
  ),
};

export default modelProperties;
