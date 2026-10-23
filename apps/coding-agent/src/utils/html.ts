import { dual } from "effect/Function";

import type htmlTypes from "./html.types.ts";

function decodeCodePoint(codePoint: number): string | undefined {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return undefined;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntity(entity: string): string | undefined {
  switch (entity) {
    case "amp":
      return "&";
    case "lt":
      return "<";
    case "gt":
      return ">";
    case "quot":
      return '"';
    case "apos":
      return "'";
  }

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    return decodeCodePoint(Number.parseInt(entity.slice(2), 16));
  }

  if (entity.startsWith("#")) {
    return decodeCodePoint(Number.parseInt(entity.slice(1), 10));
  }

  return undefined;
}

function decodeHtmlEntityAtImpl(
  html: string,
  index: number,
): htmlTypes.DecodedHtmlEntity | undefined {
  const semicolonIndex = html.indexOf(";", index + 1);
  if (semicolonIndex === -1 || semicolonIndex - index > 16) {
    return undefined;
  }

  const entity = html.slice(index + 1, semicolonIndex);
  const decoded = decodeHtmlEntity(entity);
  if (decoded === undefined) {
    return undefined;
  }

  return { length: semicolonIndex - index + 1, text: decoded };
}

const decodeHtmlEntityAt: {
  (html: string, index: number): htmlTypes.DecodedHtmlEntity | undefined;
  (index: number): (html: string) => htmlTypes.DecodedHtmlEntity | undefined;
} = dual((args: IArguments) => args.length >= 2, decodeHtmlEntityAtImpl);

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

const html = {
  decodeHtmlEntity,
  decodeHtmlEntityAt,
  escapeXml,
};

export default html;
