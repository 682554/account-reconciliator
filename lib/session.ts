import { EncryptJWT, jwtDecrypt } from "jose";

const COOKIE_NAME = "reconciliator_session";
const SESSION_TTL_SECONDS = 60 * 55; // matches Google's ~1hr "online" access token lifetime, minus a safety buffer
export const OAUTH_STATE_COOKIE_NAME = "reconciliator_oauth_state";

export type SessionData = {
  googleAccessToken: string;
  googleTokenExpiresAt: number;
};

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET env var must be set to a random string of at least 32 characters."
    );
  }
  return new TextEncoder().encode(secret.slice(0, 32));
}

export async function encryptSession(data: SessionData): Promise<string> {
  const key = getSecretKey();
  return new EncryptJWT({ ...data })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(key);
}

export async function decryptSession(token: string): Promise<SessionData | null> {
  try {
    const key = getSecretKey();
    const { payload } = await jwtDecrypt(token, key);
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;
