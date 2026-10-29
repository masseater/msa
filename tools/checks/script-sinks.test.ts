import { expect, it } from "vite-plus/test";

import lintProbe from "./lint-probe.ts";
import localTimeCheck from "./local-time.ts";

const { codesOnLine, lintAndInspectProbes, lintProbes, readRepoFile } = lintProbe;

const SCRIPT_DIR = "apps/coding-agent/src/core/export-html";

const TAG = "script";
const ON = "on";
const SCHEME = "javascript";
const LOCALE = "new Date().toLocaleString()";

const SCRIPT_ELEMENT = `const s = document.createElement("${TAG}");`;

const JS_URL = `["java", "${SCHEME.slice(4)}:${LOCALE}"].join("")`;

const HANDLER_HTML = `["<img src=x o", 'nerror="${LOCALE}">'].join("")`;

const UNRESOLVED = "msa-local-time-unresolved-probe";

const SCRIPT_SINK = ["scriptSink"];

const HTML_SINK = ["htmlSink"];

const NAVIGATION_SINK = ["navigationSink"];

type SinkCase = readonly [statement: string, rules: readonly string[]];

const sinkCases: Readonly<Record<string, SinkCase>> = {
  anchorBareSafeUrl: [`document.createElement("a").href = safeUrl(${JS_URL});`, NAVIGATION_SINK],
  anchorHref: [`document.createElement("a").href = ${JS_URL};`, NAVIGATION_SINK],
  anchorSafeUrl: [`document.createElement("a").href = globalThis.msaHtml.safeUrl(${JS_URL});`, []],
  anchorShadowedSafeUrl: [
    `function go(globalThis) {\n  document.createElement("a").href = globalThis.msaHtml.safeUrl(${JS_URL});\n}\ngo({ msaHtml: { safeUrl: String } });`,
    NAVIGATION_SINK,
  ],
  appendHTMLUnsafe: [`document.body.appendHTMLUnsafe(${HANDLER_HTML});`, HTML_SINK],
  areaHref: [`document.createElement("area").href = ${JS_URL};`, NAVIGATION_SINK],
  attrValue: [`document.body.getAttributeNode("title").value = "${LOCALE}";`, SCRIPT_SINK],
  attributeConcat: [`document.body.setAttribute("${ON}" + "click", "${LOCALE}");`, SCRIPT_SINK],
  attributeHandler: [`document.body.setAttribute("${ON}click", "${LOCALE}");`, SCRIPT_SINK],
  attributeNode: [
    `const a = document.createAttribute("title");\na.value = "${LOCALE}";\ndocument.body.setAttributeNode(a);`,
    SCRIPT_SINK,
  ],
  attributePlain: ['document.body.setAttribute("aria-pressed", "true");', []],
  attributeSrcdoc: [`document.body.setAttribute("srcdoc", ${HANDLER_HTML});`, SCRIPT_SINK],
  bareLocation: [`location = ${JS_URL};`, NAVIGATION_SINK],
  bareOpen: [`open(${JS_URL});`, NAVIGATION_SINK],
  buttonFormAction: [`document.createElement("button").formAction = ${JS_URL};`, NAVIGATION_SINK],
  contextualFragment: [
    `document.createRange().createContextualFragment(${HANDLER_HTML});`,
    HTML_SINK,
  ],
  divText: [`document.createElement("div").textContent = "${LOCALE}";`, []],
  documentLocation: [`document.location = ${JS_URL};`, NAVIGATION_SINK],
  documentWrite: [`document.write(${HANDLER_HTML});`, HTML_SINK],
  documentWriteln: [`document.writeln(${HANDLER_HTML});`, HTML_SINK],
  elementVariable: [
    'const tag = ["scr", "ipt"].join("");\ndocument.createElement(tag);',
    SCRIPT_SINK,
  ],
  formAction: [`document.createElement("form").action = ${JS_URL};`, NAVIGATION_SINK],
  frameSrc: [`document.createElement("frame").src = ${JS_URL};`, NAVIGATION_SINK],
  handlerProperty: [`document.body.${ON}click = "${LOCALE}";`, SCRIPT_SINK],
  htmlFragment: [
    `document.body.replaceChildren(globalThis.msaHtml.htmlFragment(${HANDLER_HTML}));`,
    [],
  ],
  iframeSrc: [`document.createElement("iframe").src = ${JS_URL};`, NAVIGATION_SINK],
  iframeSrcdoc: [`document.createElement("iframe").srcdoc = ${HANDLER_HTML};`, HTML_SINK],
  imageSrc: ['document.createElement("img").src = "a.png";', []],
  importScripts: ['importScripts("worker.js");', SCRIPT_SINK],
  importedInnerHTML: [
    `import page from "${UNRESOLVED}";\npage.view.innerHTML = ${HANDLER_HTML};`,
    [],
  ],
  importedWorker: [`import { Workers } from "${UNRESOLVED}";\nWorkers.Worker("ci");`, []],
  innerHTML: [
    `const d = document.createElement("div");\nd.innerHTML = ${HANDLER_HTML};`,
    HTML_SINK,
  ],
  innerHTMLParameter: [
    'function put(el, html) {\n  el.innerHTML = html;\n}\nput(document.body, "");',
    HTML_SINK,
  ],
  insertAdjacentHTML: [
    `document.body.insertAdjacentHTML("beforeend", ${HANDLER_HTML});`,
    HTML_SINK,
  ],
  locationAssign: [`location.assign(${JS_URL});`, NAVIGATION_SINK],
  locationHref: [`location.href = ${JS_URL};`, NAVIGATION_SINK],
  locationReplace: [`location.replace(${JS_URL});`, NAVIGATION_SINK],
  outerHTML: [`document.createElement("div").outerHTML = ${HANDLER_HTML};`, HTML_SINK],
  parseFromString: [`new DOMParser().parseFromString(${HANDLER_HTML}, "text/html");`, HTML_SINK],
  parseHTMLUnsafe: [`Document.parseHTMLUnsafe(${HANDLER_HTML});`, HTML_SINK],
  scriptAppend: [`${SCRIPT_ELEMENT}\ns.append("${LOCALE}");`, SCRIPT_SINK],
  scriptInnerHTML: [
    `${SCRIPT_ELEMENT}\ns.innerHTML = "${LOCALE}";`,
    [...SCRIPT_SINK, ...HTML_SINK],
  ],
  scriptInnerText: [`${SCRIPT_ELEMENT}\ns.innerText = "${LOCALE}";`, SCRIPT_SINK],
  scriptSrc: [`${SCRIPT_ELEMENT}\ns.src = \`data:text/${SCHEME},\${"${LOCALE}"}\`;`, SCRIPT_SINK],
  scriptText: [`${SCRIPT_ELEMENT}\ns.text = "${LOCALE}";`, SCRIPT_SINK],
  scriptTextContent: [`${SCRIPT_ELEMENT}\ns.textContent = "${LOCALE}";`, SCRIPT_SINK],
  serviceWorker: ['navigator.serviceWorker.register("worker.js");', SCRIPT_SINK],
  setAttributeHref: [`document.body.setAttribute("href", ${JS_URL});`, NAVIGATION_SINK],
  setAttributeXlinkHref: [
    `document.body.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", ${JS_URL});`,
    NAVIGATION_SINK,
  ],
  setHTMLUnsafe: [`document.body.setHTMLUnsafe(${HANDLER_HTML});`, HTML_SINK],
  shadowInnerHTML: [
    `document.body.attachShadow({ mode: "open" }).innerHTML = ${HANDLER_HTML};`,
    HTML_SINK,
  ],
  sharedWorker: ['new SharedWorker("worker.js");', SCRIPT_SINK],
  stringReplace: ['console.log("a".replace("a", "b"));', []],
  svgHref: [
    `document.createElementNS("http://www.w3.org/2000/svg", "a").href.baseVal = ${JS_URL};`,
    NAVIGATION_SINK,
  ],
  timerFunction: ["setTimeout(() => undefined, 0);", []],
  timerString: [`const code = "${LOCALE}";\nsetTimeout(code, 0);`, SCRIPT_SINK],
  windowLocation: [`window.location = ${JS_URL};`, NAVIGATION_SINK],
  windowOpen: [`window.open(${JS_URL});`, NAVIGATION_SINK],
  worker: ['const worker = new Worker("worker.js");\nworker.terminate();', SCRIPT_SINK],
};

const sinkProbes = Object.entries(sinkCases).map(([name, [statement, rules]]) => ({
  flagged: rules.length > 0,
  name,
  path: `${SCRIPT_DIR}/local-time-sink-${name}-probe.js`,
  rules,
  source: `${statement}\n`,
}));

const sinkRuleSets = [...new Set(sinkProbes.map(({ rules }) => rules.join(",")))].filter(
  (rules) => rules !== "",
);

const newFunction = {
  path: "scripts/local-time-new-function-probe.js",
  source: `const run = new Function("return ${LOCALE}");\nconsole.log(run());\n`,
};

const evalCall = {
  path: "scripts/local-time-eval-probe.js",
  source: `console.log(eval("${LOCALE}"));\n`,
};

const constructorCall = {
  path: "scripts/local-time-constructor-probe.js",
  source: `console.log((() => undefined).constructor("return ${LOCALE}")());\n`,
};

const PROTOTYPE_WRITE = "msa(no-prototype-write)";

const EVAL = "eslint(no-eval)";

const EVAL_RULE = "eslint/no-eval";

const NEW_FUNC = "eslint(no-new-func)";

const NEW_FUNC_RULE = "eslint/no-new-func";

type Probe = { readonly flagged: boolean; readonly name: string; readonly path: string };

const reported = (list: readonly Probe[], isFlagged: (path: string) => boolean) =>
  Object.fromEntries(list.map(({ name, path }) => [name, isFlagged(path)]));

const expected = (list: readonly Probe[]) =>
  Object.fromEntries(list.map(({ flagged, name }) => [name, flagged]));

const flaggedProbes = sinkProbes.filter((probe) => probe.flagged);

const probeFiles = (
  browserScripts: string,
  htmlOwner: string,
): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    [...sinkProbes, constructorCall, evalCall, newFunction].map(({ path, source }) => [
      path,
      source,
    ]),
  ),
  [localTimeCheck.BROWSER_SCRIPTS]: browserScripts,
  [localTimeCheck.HTML_OWNER]: htmlOwner,
});

type Findings = ReturnType<typeof localTimeCheck.scan>;

const scansOf = (run: string) => {
  const scope = { files: (name: string) => name.startsWith(`${run}/`), root: run };
  return {
    all: localTimeCheck.scan(scope),
    withoutRules: new Map(
      sinkRuleSets.map((rules) => [rules, localTimeCheck.scan(scope, new Set(rules.split(",")))]),
    ),
  };
};

const flaggedIn = (findings: Findings) => (path: string) =>
  findings.some((finding) => finding.file === path);

const flaggedWithoutRule = (withoutRules: ReadonlyMap<string, Findings>) => (path: string) => {
  const probe = sinkProbes.find((candidate) => candidate.path === path)!;
  return flaggedIn(withoutRules.get(probe.rules.join(","))!)(path);
};

it("reports every browser sink that runs a string as JS, and only while its rule is on", () =>
  Promise.all([
    readRepoFile(localTimeCheck.BROWSER_SCRIPTS),
    readRepoFile(localTimeCheck.HTML_OWNER),
  ])
    .then(([browserScripts, htmlOwner]) =>
      lintAndInspectProbes(probeFiles(browserScripts, htmlOwner), scansOf),
    )
    .then(({ diagnostics, inspected: { all, withoutRules } }) => {
      const flagged = flaggedIn(all);
      expect({
        constructorCall: codesOnLine(diagnostics, constructorCall.path, 1, PROTOTYPE_WRITE),
        evalCall: codesOnLine(diagnostics, evalCall.path, 1, EVAL),
        htmlOwner: flagged(localTimeCheck.HTML_OWNER),
        newFunction: {
          lint: codesOnLine(diagnostics, newFunction.path, 1, NEW_FUNC),
          scan: flagged(newFunction.path),
        },
        sinks: reported(sinkProbes, flagged),
        sinksWithoutRule: reported(flaggedProbes, flaggedWithoutRule(withoutRules)),
      }).toEqual({
        constructorCall: [PROTOTYPE_WRITE],
        evalCall: [EVAL],
        htmlOwner: false,
        newFunction: { lint: [NEW_FUNC], scan: false },
        sinks: expected(sinkProbes),
        sinksWithoutRule: Object.fromEntries(flaggedProbes.map(({ name }) => [name, false])),
      });
      return undefined;
    }));

it("leaves the eval and Function constructor probes unreported once their rules are allowed", () =>
  lintProbes({ [evalCall.path]: evalCall.source, [newFunction.path]: newFunction.source }, [
    "-A",
    EVAL_RULE,
    "-A",
    NEW_FUNC_RULE,
  ]).then((diagnostics) => {
    expect({
      evalCall: codesOnLine(diagnostics, evalCall.path, 1, EVAL),
      newFunction: codesOnLine(diagnostics, newFunction.path, 1, NEW_FUNC),
    }).toEqual({ evalCall: [], newFunction: [] });
    return undefined;
  }));
