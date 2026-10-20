import { crc32, deflateRawSync } from "node:zlib";

import { dual } from "effect/Function";

import { nowMs, toDate } from "../core/platform.ts";
import { writeFile } from "./node-fs.ts";

interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    day:
      ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

interface ZipEntryParts {
  readonly files: Buffer[];
  readonly directory: Buffer[];
  readonly size: number;
}

function buildZipEntry(entry: ZipEntry, offset: number, time: number, day: number): ZipEntryParts {
  const name = Buffer.from(entry.name);
  const data = typeof entry.data === "string" ? Buffer.from(entry.data) : Buffer.from(entry.data);
  const compressed = deflateRawSync(data);
  const checksum = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);

  return {
    directory: [central, name],
    files: [local, name, compressed],
    size: local.length + name.length + compressed.length,
  };
}

function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  const { time, day } = dosDateTime(toDate(nowMs()));
  let offset = 0;

  for (const entry of entries) {
    const parts = buildZipEntry(entry, offset, time, day);
    files.push(...parts.files);
    directory.push(...parts.directory);
    offset += parts.size;
  }

  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, centralDirectory, end]);
}

function writeZipArchiveImpl(filePath: string, entries: readonly ZipEntry[]): Promise<void> {
  return writeFile({ data: createZipArchive(entries), path: filePath });
}

export const writeZipArchive: {
  (filePath: string, entries: readonly ZipEntry[]): Promise<void>;
  (entries: readonly ZipEntry[]): (filePath: string) => Promise<void>;
} = dual((args: IArguments) => args.length >= 2, writeZipArchiveImpl);
