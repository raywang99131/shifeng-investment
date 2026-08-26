const encoder = new TextEncoder();

const bearerToken = (request: Request): string | null => {
  const value = request.headers.get('authorization');
  const match = value?.match(/^Bearer ([^\s]+)$/);
  return match?.[1] ?? null;
};

const digest = async (value: string): Promise<Uint8Array> => new Uint8Array(
  await crypto.subtle.digest('SHA-256', encoder.encode(value)),
);

/**
 * Compares fixed-length SHA-256 digests without an early exit. Tokens are never
 * compared directly, so token length and prefix cannot influence the loop.
 */
export async function constantTimeBearerEquals(request: Request, expectedToken: string): Promise<boolean> {
  const supplied = bearerToken(request);
  const [left, right] = await Promise.all([digest(supplied ?? ''), digest(expectedToken)]);
  let difference = supplied === null || expectedToken.length === 0 ? 1 : 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
