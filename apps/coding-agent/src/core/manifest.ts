import { Predicate } from "effect";

import text from "../utils/text.ts";
import type manifestTypes from "./manifest.types.ts";
import platform from "./platform/index.ts";

const { stripBom } = text;

const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

function readMsaManifest(packageJsonPath: string): Promise<manifestTypes.MsaManifest | null> {
  return platform.files.readText(packageJsonPath).then(manifestOf, () => null);
}

function manifestOf(content: string): manifestTypes.MsaManifest | null {
  try {
    const pkg: unknown = JSON.parse(stripBom(content));
    if (!Predicate.isObject(pkg)) {
      return null;
    }
    const section = Predicate.isObject(pkg["msa"])
      ? pkg["msa"]
      : Predicate.isObject(pkg["pi"])
        ? pkg["pi"]
        : null;
    if (section === null) {
      return null;
    }

    const manifest: manifestTypes.MsaManifest = {};
    for (const field of RESOURCE_FIELDS) {
      const entries = section[field];
      if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) {
        manifest[field] = entries;
      }
    }
    return manifest;
  } catch {
    return null;
  }
}

const manifest = {
  readMsaManifest,
};

export default manifest;
