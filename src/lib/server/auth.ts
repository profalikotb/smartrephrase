import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sr_session";
export const SESSION_TTL_S = 30 * 24 * 3600;

interface SessionPayload {
  v: 1;
  sid: string;
  exp: number;
}

const b64u = (b: Buffer) => b.toString("base64url");

function sign(data: string, secret: string): string {
  return b64u(createHmac("sha256", secret).update(data).digest());
}

export function createSessionToken(secret: string, nowS = Math.floor(Date.now() / 1000)): string {
  const payload: SessionPayload = { v: 1, sid: b64u(randomBytes(12)), exp: nowS + SESSION_TTL_S };
  const data = b64u(Buffer.from(JSON.stringify(payload)));
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, nowS = Math.floor(Date.now() / 1000)): SessionPayload | null {
  if (!token || token.length > 512) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (p.v !== 1 || typeof p.exp !== "number" || p.exp < nowS || typeof p.sid !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

/** Constant-time comparison independent of input length. */
export function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_S}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
