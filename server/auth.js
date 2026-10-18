// Signed session cookies and Google ID-token verification. No framework needed.
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

export const SESSION_HOURS = 12;

export function signSession(payload, secret) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + SESSION_HOURS * 3600_000 }));
  return `${body}.${mac(body, secret)}`;
}

export function readSession(token, secret) {
  if (!token || !secret || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig ?? '');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export const parseCookies = (header = '') =>
  Object.fromEntries(header.split(';').map((s) => s.trim()).filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
  }));

export const sessionCookie = (value, { secure }) =>
  `session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
export const clearCookie = ({ secure }) => `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/** Returns async (credential) => { email, emailVerified, hd, name } using Google's public keys. */
export function googleVerifier(clientId) {
  let client;
  return async (credential) => {
    const { OAuth2Client } = await import('google-auth-library');
    client ??= new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    return { email: p.email, emailVerified: !!p.email_verified, hd: p.hd, name: p.name };
  };
}
