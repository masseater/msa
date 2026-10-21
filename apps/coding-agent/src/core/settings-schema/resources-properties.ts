import { Type } from "typebox";

import settingsDefaults from "../settings-defaults.ts";
import resourceSchemas from "./resource-schemas.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { PackageSourceSchema, SkillsInputSchema } = resourceSchemas;

const resourceProperties = {
  defaultTools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Initial tool selection. Plain names replace the inherited selection; +name and -name entries add or remove tools.",
    }),
  ),
  enableSkillCommands: Type.Optional(
    Type.Boolean({
      default: SETTINGS_DEFAULTS.enableSkillCommands,
      description: "Register skills as /name commands.",
    }),
  ),
  extensions: Type.Optional(
    Type.Array(Type.String(), { description: "Local extension file paths or directories." }),
  ),
  npmCommand: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Command used for npm package lookup and installation, in argv form such as ["mise", "exec", "node@20", "--", "npm"].',
    }),
  ),
  packages: Type.Optional(
    Type.Array(PackageSourceSchema, {
      description: "npm or git package sources, as strings or objects with resource filtering.",
    }),
  ),
  prompts: Type.Optional(
    Type.Array(Type.String(), {
      description: "Local prompt template file paths or directories.",
    }),
  ),
  skills: Type.Optional(SkillsInputSchema),
  themes: Type.Optional(
    Type.Array(Type.String(), { description: "Local theme file paths or directories." }),
  ),
};

export default resourceProperties;
