import agent from "@msa/agent-core";
import compat from "@msa/ai/compat";
import oauth from "@msa/ai/oauth";
import all from "@msa/ai/providers/all";
import tui from "@msa/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";

import bundledMsaCodingAgent from "../../index.ts";

const VIRTUAL_MODULES: Record<string, unknown> = {
  "@earendil-works/pi-agent-core": agent,
  "@earendil-works/pi-ai": compat,
  "@earendil-works/pi-ai/compat": compat,
  "@earendil-works/pi-ai/oauth": oauth,
  "@earendil-works/pi-ai/providers/all": all,
  "@earendil-works/pi-coding-agent": bundledMsaCodingAgent,
  "@earendil-works/pi-tui": tui,
  "@mariozechner/pi-agent-core": agent,
  "@mariozechner/pi-ai": compat,
  "@mariozechner/pi-ai/compat": compat,
  "@mariozechner/pi-ai/oauth": oauth,
  "@mariozechner/pi-ai/providers/all": all,
  "@mariozechner/pi-coding-agent": bundledMsaCodingAgent,
  "@mariozechner/pi-tui": tui,
  "@msa/agent-core": agent,
  "@msa/ai": compat,
  "@msa/ai/compat": compat,
  "@msa/ai/oauth": oauth,
  "@msa/ai/providers/all": all,
  "@msa/coding-agent": bundledMsaCodingAgent,
  "@msa/tui": tui,
  "@sinclair/typebox": bundledTypebox,
  "@sinclair/typebox/compile": bundledTypeboxCompile,
  "@sinclair/typebox/value": bundledTypeboxValue,
  typebox: bundledTypebox,
  "typebox/compile": bundledTypeboxCompile,
  "typebox/value": bundledTypeboxValue,
};

const virtualModules = {
  VIRTUAL_MODULES,
};

export default virtualModules;
