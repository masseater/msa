import { dual } from "effect/Function";
import { type Static, type TProperties, Type } from "typebox";
import { Compile } from "typebox/compile";

import themeTokens from "./theme-tokens.ts";
import type themeTokensTypes from "./theme-tokens.types.ts";

const { THEME_TOKENS } = themeTokens;

function colorValue(description?: string) {
  return Type.Union(
    [
      Type.String({
        description:
          "Hex color (#RGB or #RRGGBB), OKLCH or OKHSL color, variable reference, or empty string for terminal default",
      }),
      Type.Integer({
        description: "256-color palette index (0-255)",
        maximum: 255,
        minimum: 0,
      }),
    ],
    description !== undefined && description !== "" ? { description } : {},
  );
}

const ColorValueSchema = colorValue();

type ColorValue = Static<typeof ColorValueSchema>;

function themeTokenProperties(tokens: themeTokensTypes.ThemeTokenDescriptors): TProperties {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, descriptor]) => {
      const schema = colorValue(descriptor.description);
      return [name, descriptor.fallback === undefined ? schema : Type.Optional(schema)];
    }),
  );
}

const ThemeColorsSchema = Type.Unsafe<themeTokensTypes.ThemeColorValues<ColorValue>>(
  Type.Object(themeTokenProperties(THEME_TOKENS), {
    additionalProperties: false,
    description:
      "Theme color definitions (scrollbar, thinkingMax, and search highlight colors are optional and use compatible fallbacks)",
  }),
);

const ThemeJsonSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String({ description: "JSON schema reference" })),
    appearance: Type.Optional(
      Type.Union([Type.Literal("dark"), Type.Literal("light")], {
        description:
          "Background the theme is designed for. Detected from the theme colors when omitted.",
      }),
    ),
    colors: ThemeColorsSchema,
    export: Type.Optional(
      Type.Object(
        {
          cardBg: Type.Optional(colorValue("Card/container background color")),
          infoBg: Type.Optional(colorValue("Info sections background (system prompt, notices)")),
          pageBg: Type.Optional(colorValue("Page background color")),
        },
        {
          additionalProperties: false,
          description:
            "Optional colors for HTML export (defaults derived from userMessageBg if not specified)",
        },
      ),
    ),
    name: Type.String({
      description:
        "Theme name. Must not contain '/' because it is reserved for automatic light/dark theme settings.",
      pattern: "^[^/]+$",
    }),
    vars: Type.Optional(
      Type.Record(Type.String(), ColorValueSchema, {
        description: "Reusable color variables",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Theme schema for msa coding agent",
    title: "msa Coding Agent Theme",
  },
);

type ValidatedThemeJson = Static<typeof ThemeJsonSchema>;

const compiledThemeSchema = Compile(ThemeJsonSchema);

const validateThemeJson: {
  (json: unknown): (label: string) => ValidatedThemeJson;
  (label: string, json: unknown): ValidatedThemeJson;
} = dual(2, (label: string, json: unknown): ValidatedThemeJson => {
  if (
    typeof json === "object" &&
    json !== null &&
    "name" in json &&
    typeof json.name === "string" &&
    json.name.includes("/")
  ) {
    throw new Error(
      `Invalid theme name "${json.name}": theme names cannot contain "/" because it is reserved for automatic light/dark theme settings.`,
    );
  }

  if (!compiledThemeSchema.Check(json)) {
    const errors = Array.from(compiledThemeSchema.Errors(json));
    const missingColors = new Set<string>();
    const otherErrors: string[] = [];

    for (const error of errors) {
      if (error.keyword === "required" && error.instancePath === "/colors") {
        const requiredProperties = (error.params as { requiredProperties?: string[] })
          .requiredProperties;
        for (const requiredProperty of requiredProperties ?? []) {
          missingColors.add(requiredProperty);
        }
        continue;
      }

      const path = error.instancePath || "/";
      otherErrors.push(`  - ${path}: ${error.message}`);
    }

    let errorMessage = `Invalid theme "${label}":\n`;
    if (missingColors.size > 0) {
      errorMessage = missingColorsMessage(errorMessage, missingColors);
      errorMessage += "\nSee the built-in themes (dark.json, light.json) for reference values.";
    }
    if (otherErrors.length > 0) {
      errorMessage += `\n\nOther errors:\n${otherErrors.join("\n")}`;
    }

    throw new Error(errorMessage);
  }

  return json as ValidatedThemeJson;
});

const themeSchema = {
  ColorValueSchema,
  ThemeJsonSchema,
  validateThemeJson,
};

export default themeSchema;

function missingColorsMessage(errorMessage: string, missingColors: Set<string>) {
  errorMessage += "\nMissing required color tokens:\n";
  errorMessage += Array.from(missingColors)
    .sort()
    .map((color) => `  - ${color}`)
    .join("\n");
  errorMessage += '\n\nPlease add these colors to your theme\'s "colors" object.';
  return errorMessage;
}
