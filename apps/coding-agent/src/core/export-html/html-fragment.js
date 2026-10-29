const NAVIGABLE_PROTOCOLS = new Set([
  "blob:",
  "file:",
  "ftp:",
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

const URL_ATTRIBUTES = new Set(["action", "data", "formaction", "href", "src"]);

const RUNNING_ELEMENTS = new Set([
  "animate",
  "animatemotion",
  "animatetransform",
  "base",
  "meta",
  "script",
  "set",
]);

const PARSE_BASE = "https://parse.invalid/";

function urlProtocol(value) {
  try {
    return new URL(String(value), PARSE_BASE).protocol;
  } catch {
    return undefined;
  }
}

function isAllowedUrl(value, element) {
  const protocol = urlProtocol(value);
  return NAVIGABLE_PROTOCOLS.has(protocol) || (protocol === "data:" && element.localName === "img");
}

function safeUrl(value) {
  return NAVIGABLE_PROTOCOLS.has(urlProtocol(value)) ? String(value) : "about:blank";
}

function isRunningAttribute(attribute, element) {
  const name = String(attribute.localName).toLowerCase();
  if (name.startsWith("on") || name === "srcdoc") return true;
  return URL_ATTRIBUTES.has(name) && !isAllowedUrl(attribute.value, element);
}

function disarm(root) {
  for (const element of [...root.querySelectorAll("*")]) {
    if (RUNNING_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (isRunningAttribute(attribute, element)) element.removeAttributeNode(attribute);
    }
    if (element.localName === "template") disarm(element.content);
  }
  return root;
}

function htmlFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  return disarm(template.content);
}

Object.defineProperty(globalThis, "msaHtml", {
  value: Object.freeze({ htmlFragment, safeUrl }),
});
