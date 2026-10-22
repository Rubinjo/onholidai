const sensitiveText =
  /supplier\s*(?:amount|cost|price)|platform\s*margin|net\s*(?:amount|rate)|wholesale|commission|margin|api\s*key|access\s*token|authorization\s*(?:[:=]|bearer|basic)|bearer|password|secret|credential|passport|card\s*number|payment\s*token|cvv|cvc|private\s*key/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const cardPattern = /(?:\d[ -]?){13,19}/;

export function containsSensitiveText(value: string): boolean {
  if (value.length > 16_384) return true;
  let decoded = value;
  for (let depth = 0; depth < 3 && /%[0-9a-f]{2}/i.test(decoded); depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return true;
    }
  }
  const normalized = decoded.normalize("NFKC").replace(/[_-]+/g, " ");
  return (
    sensitiveText.test(normalized) || emailPattern.test(normalized) || cardPattern.test(normalized)
  );
}

export function publicSupplierText(value: string): string {
  return containsSensitiveText(value) ? "[REDACTED]" : value;
}
