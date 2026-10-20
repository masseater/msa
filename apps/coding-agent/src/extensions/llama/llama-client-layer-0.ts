import client from "./client.ts";

const { normalizeLlamaServerUrl } = client;

export default abstract class LlamaClientLayer0 {
  constructor(serverUrl: string, apiKey?: string) {
    this.serverUrl = normalizeLlamaServerUrl(serverUrl);
    this.apiKey = apiKey;
  }

  serverUrl!: string;
  protected apiKey!: string | undefined;
}
