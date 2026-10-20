function sanitizeSurrogates(text: string): string {
  return text.replaceAll(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
    "",
  );
}

const sanitizeUnicode = {
  sanitizeSurrogates,
};

export default sanitizeUnicode;
