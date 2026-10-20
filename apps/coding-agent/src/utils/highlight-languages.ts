import hljs from "highlight.js/lib/core.js";

import highlightC from "./highlight-c.ts";
import highlightOther from "./highlight-other.ts";
import highlightScript from "./highlight-script.ts";

const { cLanguages } = highlightC;
const { scriptLanguages } = highlightScript;
const { otherLanguages } = highlightOther;

const eagerLanguages = {
  ...cLanguages,
  ...scriptLanguages,
  ...otherLanguages,
};

for (const [name, language] of Object.entries(eagerLanguages)) {
  hljs.registerLanguage(name, language);
}

const highlightJs = hljs;

const highlightLanguages = {
  eagerLanguages,
  highlightJs,
};

export default highlightLanguages;
