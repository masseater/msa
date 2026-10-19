import * as bundledMsaAgentCore from "@msa/agent-core";
import * as bundledMsaAiCompat from "@msa/ai/compat";
import * as bundledMsaAiOauth from "@msa/ai/oauth";
import * as bundledMsaAiProviders from "@msa/ai/providers/all";
import * as bundledMsaTui from "@msa/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";

import * as bundledMsaCodingAgent from "../../index.ts";

export const VIRTUAL_MODULES: Record<string, unknown> = {
  typebox: bundledTypebox,
  "typebox/compile": bundledTypeboxCompile,
  "typebox/value": bundledTypeboxValue,
  "@sinclair/typebox": bundledTypebox,
  "@sinclair/typebox/compile": bundledTypeboxCompile,
  "@sinclair/typebox/value": bundledTypeboxValue,
  "@msa/agent-core": bundledMsaAgentCore,
  "@msa/tui": bundledMsaTui,
  "@msa/ai": bundledMsaAiCompat,
  "@msa/ai/compat": bundledMsaAiCompat,
  "@msa/ai/oauth": bundledMsaAiOauth,
  "@msa/ai/providers/all": bundledMsaAiProviders,
  "@msa/coding-agent": bundledMsaCodingAgent,
  "@mariozechner/pi-agent-core": bundledMsaAgentCore,
  "@mariozechner/pi-tui": bundledMsaTui,
  "@mariozechner/pi-ai": bundledMsaAiCompat,
  "@mariozechner/pi-ai/compat": bundledMsaAiCompat,
  "@mariozechner/pi-ai/oauth": bundledMsaAiOauth,
  "@mariozechner/pi-ai/providers/all": bundledMsaAiProviders,
  "@mariozechner/pi-coding-agent": bundledMsaCodingAgent,
  "@earendil-works/pi-agent-core": bundledMsaAgentCore,
  "@earendil-works/pi-tui": bundledMsaTui,
  "@earendil-works/pi-ai": bundledMsaAiCompat,
  "@earendil-works/pi-ai/compat": bundledMsaAiCompat,
  "@earendil-works/pi-ai/oauth": bundledMsaAiOauth,
  "@earendil-works/pi-ai/providers/all": bundledMsaAiProviders,
  "@earendil-works/pi-coding-agent": bundledMsaCodingAgent,
};
