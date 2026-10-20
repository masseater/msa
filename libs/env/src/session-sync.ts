import type sessionTypes from "./session.types.ts";

const SYNC_NOISE_LIMIT = 1024 * 1024;

const syncSession = (
  session: sessionTypes.Session,
  onLog: ((text: string) => void) | undefined,
): boolean => {
  const marker = Buffer.from(`MSA-ENV ${session.token}\n`, "utf8");
  const all = session.peek(session.buffered);
  const index = all.indexOf(marker);
  if (index === -1) {
    if (session.buffered > SYNC_NOISE_LIMIT) session.consume(session.buffered - marker.length);
    return false;
  }
  const noise = all.subarray(0, index).toString("utf8").trim();
  if (noise !== "") onLog?.(noise);
  session.consume(index + marker.length);
  session.synced = true;
  return true;
};

const sessionSync = { syncSession };

export default sessionSync;
