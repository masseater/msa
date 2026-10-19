import hljs from "highlight.js/lib/core.js";

import { cLanguages } from "./highlight-c.ts";
import { otherLanguages } from "./highlight-other.ts";
import { scriptLanguages } from "./highlight-script.ts";

export const eagerLanguages = {
  ...cLanguages,
  ...scriptLanguages,
  ...otherLanguages,
};

for (const [name, language] of Object.entries(eagerLanguages)) {
  hljs.registerLanguage(name, language);
}

export const highlightJs = hljs;
