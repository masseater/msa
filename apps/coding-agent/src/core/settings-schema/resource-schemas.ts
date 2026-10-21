import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

const PrWatchSettingsSchema = Type.Object({
  intervalSeconds: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.prWatch.intervalSeconds,
      description: "Seconds between checks of a watched pull request.",
      minimum: 5,
    }),
  ),
  statusIntervalSeconds: Type.Optional(
    Type.Number({
      default: SETTINGS_DEFAULTS.prWatch.statusIntervalSeconds,
      description: "Seconds without a change before a watch reports its status again.",
      minimum: 30,
    }),
  ),
});

const PackageSourceSchema = Type.Union(
  [
    Type.String({ description: "Load all resources from the package." }),
    Type.Object({
      autoload: Type.Optional(
        Type.Boolean({
          description: "When false, start empty and only apply explicit resource patterns.",
        }),
      ),
      extensions: Type.Optional(Type.Array(Type.String())),
      prompts: Type.Optional(Type.Array(Type.String())),
      skills: Type.Optional(Type.Array(Type.String())),
      source: Type.String(),
      themes: Type.Optional(Type.Array(Type.String())),
    }),
  ],
  {
    description:
      "Package source for npm or git packages. Use the string form to load all resources or the object form to filter resources.",
  },
);

const ModelPolicySettingsSchema = Type.Object(
  {
    allow: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Models that may be used, in the same format as the --models CLI flag. When set, models outside the list are unusable.",
      }),
    ),
    deny: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Models that may not be used, in the same format as the --models CLI flag. A deny pattern wins over any allow pattern.",
      }),
    ),
  },
  {
    description:
      "Models a session may use. Deny wins, and a non-empty allow list restricts use to the models it names. Separate from enabledModels, which only narrows startup selection and Ctrl+P cycling.",
  },
);

const StringArraySchema = Type.Array(Type.String());

const SkillsInputSchema = Type.Union(
  [
    StringArraySchema,
    Type.Object(
      {
        customDirectories: Type.Optional(StringArraySchema),
        enableSkillCommands: Type.Optional(Type.Boolean()),
      },
      { deprecated: true },
    ),
  ],
  { description: "Local skill file paths or directories." },
);

const resourceSchemas = {
  ModelPolicySettingsSchema,
  PackageSourceSchema,
  PrWatchSettingsSchema,
  SkillsInputSchema,
};

export default resourceSchemas;
