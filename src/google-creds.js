import { hexToBytes } from './util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function getKey(env) {
  const hex = String(env.CREDENTIAL_KEY || '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('CREDENTIAL_KEY is missing or invalid');
  return await crypto.subtle.importKey('raw', hexToBytes(hex), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(env, plain, projectId) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(projectId) },
    key,
    enc.encode(plain)
  );
  return toB64(iv) + '.' + toB64(new Uint8Array(cipher));
}

export async function decryptSecret(env, stored, projectId) {
  const [ivPart, cipherPart] = String(stored).split('.');
  if (!ivPart || !cipherPart) throw new Error('Stored secret is malformed');
  const key = await getKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivPart), additionalData: enc.encode(projectId) },
    key,
    fromB64(cipherPart)
  );
  return dec.decode(plain);
}

export async function getGoogleCreds(env, project) {
  if (project.google_client_id && project.google_client_secret_enc) {
    try {
      return {
        clientId: project.google_client_id,
        clientSecret: await decryptSecret(env, project.google_client_secret_enc, project.id),
        custom: true,
      };
    } catch (err) {
      console.error('Could not decrypt Google credentials: ' + err.message);
      return null;
    }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      custom: false,
    };
  }
  return null;
}
