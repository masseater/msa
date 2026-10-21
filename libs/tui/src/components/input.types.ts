import type InputClass from "./input.ts";

declare namespace inputTypes {
  interface InputOptions {
    prompt?: string;
    placeholder?: string;
    placeholderStyle?: (text: string) => string;
  }

  type Input = InputClass;
}

export type { inputTypes as default };
