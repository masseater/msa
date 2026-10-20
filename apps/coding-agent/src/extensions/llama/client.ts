function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}
function normalizeLlamaServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http or https");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}
function llamaInferenceUrl(serverUrl: string): string {
  return `${normalizeLlamaServerUrl(serverUrl)}/v1`;
}

const client = {
  formatBytes,
  llamaInferenceUrl,
  normalizeLlamaServerUrl,
};

export default client;
