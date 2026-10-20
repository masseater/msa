import platform from "../core/platform.ts";

const { nowMs } = platform;

function splitBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

function stripBom(content: string): string {
  return splitBom(content).text;
}

function shortId(id: string): string {
  return id.length <= 16 ? id : id.slice(0, 8);
}

function formatAge(timestamp: number, now = nowMs()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const text = {
  formatAge,
  shortId,
  splitBom,
  stripBom,
};

export default text;
