import "server-only";

export async function withEphemeralPaymentToken<T>(token: Uint8Array, action: (token: Uint8Array) => Promise<T>): Promise<T> {
  if (token.byteLength < 16 || token.byteLength > 4096) throw new Error("Invalid ephemeral payment token");
  try {
    return await action(token);
  } finally {
    token.fill(0);
  }
}
