import assert from "node:assert/strict";

// Committed generated artifacts are stored with LF endings, but a Windows
// checkout with core.autocrlf rewrites them to CRLF. Compare content only.
export function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

export function assertGeneratedArtifact(committed, generated, message) {
  assert.equal(normalizeNewlines(committed), normalizeNewlines(generated), message);
}
