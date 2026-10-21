import type optionsModule from "./options.ts";

declare namespace optionsTypes {
  interface GeneratorOptions {
    readonly strict: boolean;
    readonly dataOnly: boolean;
    readonly jsonOnly: boolean;
    readonly jsonOutputDir: string | undefined;
    readonly pretty: boolean;
  }

  type GeneratorUsageError = (typeof optionsModule.GeneratorUsageError)["prototype"];
}

export type { optionsTypes as default };
