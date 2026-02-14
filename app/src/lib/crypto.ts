/**
 * E2E Encryption module using Web Crypto API
 *
 * Uses ECDH (P-256) for key exchange + AES-256-GCM for symmetric encryption.
 * Each user generates a key pair; shared secrets are derived per-pair via ECDH.
 *
 * Encrypted message format: `e2e::<base64(iv + ciphertext)>`
 */

const DB_NAME = "sivycord-e2e";
const DB_VERSION = 1;
const STORE_NAME = "keypairs";

// ─── IndexedDB helpers for key persistence ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Key generation & management ───

const KEY_ALGO: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };

/**
 * Generate a new ECDH key pair and persist it in IndexedDB.
 * Returns the public key as a base64 JWK string (for uploading to the server).
 */
export async function generateKeyPair(userId: string): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(KEY_ALGO, true, [
    "deriveBits",
  ]);

  // Export private key for storage
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  await dbSet(`private:${userId}`, privateJwk);
  await dbSet(`public:${userId}`, publicJwk);

  return JSON.stringify(publicJwk);
}

/**
 * Check if we have a local key pair for the given user.
 */
export async function hasLocalKeyPair(userId: string): Promise<boolean> {
  const priv = await dbGet(`private:${userId}`);
  return priv !== undefined;
}

/**
 * Get our public key as a JWK string.
 */
export async function getLocalPublicKey(
  userId: string,
): Promise<string | null> {
  const pub = await dbGet<JsonWebKey>(`public:${userId}`);
  if (!pub) return null;
  return JSON.stringify(pub);
}

/**
 * Import a remote user's public key from JWK string.
 */
async function importPublicKey(jwkStr: string): Promise<CryptoKey> {
  const jwk: JsonWebKey = JSON.parse(jwkStr);
  return crypto.subtle.importKey("jwk", jwk, KEY_ALGO, false, []);
}

/**
 * Get our private key from IndexedDB.
 */
async function getPrivateKey(userId: string): Promise<CryptoKey> {
  const jwk = await dbGet<JsonWebKey>(`private:${userId}`);
  if (!jwk) throw new Error("No private key found for this user");
  return crypto.subtle.importKey("jwk", jwk, KEY_ALGO, false, ["deriveBits"]);
}

// ─── Shared secret derivation ───

/**
 * Derive a 256-bit AES-GCM key from our private key + their public key.
 */
async function deriveSharedKey(
  myUserId: string,
  theirPublicKeyJwk: string,
): Promise<CryptoKey> {
  const myPrivateKey = await getPrivateKey(myUserId);
  const theirPublicKey = await importPublicKey(theirPublicKeyJwk);

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256,
  );

  return crypto.subtle.importKey("raw", sharedBits, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// Cache derived keys to avoid re-deriving for every message
const sharedKeyCache = new Map<string, CryptoKey>();

async function getOrDeriveSharedKey(
  myUserId: string,
  theirPublicKeyJwk: string,
): Promise<CryptoKey> {
  const cacheKey = `${myUserId}:${theirPublicKeyJwk.slice(0, 32)}`;
  if (sharedKeyCache.has(cacheKey)) {
    return sharedKeyCache.get(cacheKey)!;
  }
  const key = await deriveSharedKey(myUserId, theirPublicKeyJwk);
  sharedKeyCache.set(cacheKey, key);
  return key;
}

// ─── Encryption / Decryption ───

const E2E_PREFIX = "e2e::";

/**
 * Encrypt a plaintext message for a specific recipient.
 * Returns the encrypted message in the format: `e2e::<base64(iv + ciphertext)>`
 */
export async function encryptMessage(
  plaintext: string,
  myUserId: string,
  recipientPublicKeyJwk: string,
): Promise<string> {
  const key = await getOrDeriveSharedKey(myUserId, recipientPublicKeyJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return E2E_PREFIX + arrayBufferToBase64(combined);
}

/**
 * Decrypt an e2e-encrypted message.
 * Returns the plaintext, or the original string if not encrypted / decryption fails.
 */
export async function decryptMessage(
  encryptedMsg: string,
  myUserId: string,
  senderPublicKeyJwk: string,
): Promise<string> {
  if (!encryptedMsg.startsWith(E2E_PREFIX)) {
    return encryptedMsg; // Not encrypted
  }

  try {
    const payload = base64ToArrayBuffer(encryptedMsg.slice(E2E_PREFIX.length));
    const iv = payload.slice(0, 12);
    const ciphertext = payload.slice(12);

    const key = await getOrDeriveSharedKey(myUserId, senderPublicKeyJwk);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn("E2E decryption failed:", err);
    return "🔒 [Encrypted message — cannot decrypt]";
  }
}

/**
 * Check if a message is E2E encrypted.
 */
export function isEncryptedMessage(content: string): boolean {
  return content.startsWith(E2E_PREFIX);
}

// ─── Channel encryption with a shared group key ───

/**
 * For group/channel encryption we use a simpler approach:
 * encrypt the message with EACH participant's public key.
 *
 * Since this can be expensive for large channels, we use a
 * "sender key" strategy: generate a random AES key per message,
 * encrypt the message body with it, then wrap the AES key for
 * each participant using ECDH.
 *
 * Format: `e2e-ch::<base64(JSON{ wrapped_keys: { userId: base64 }, iv: base64, ciphertext: base64 })>`
 */

const E2E_CHANNEL_PREFIX = "e2e-ch::";

export interface ChannelParticipantKey {
  user_id: string;
  public_key: string; // JWK string
}

/**
 * Encrypt a message for a channel with multiple participants.
 */
export async function encryptChannelMessage(
  plaintext: string,
  myUserId: string,
  participants: ChannelParticipantKey[],
): Promise<string> {
  // Generate a random per-message AES key
  const messageKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );

  // Encrypt the message body
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    messageKey,
    encoded,
  );

  // Export the message key as raw bytes
  const rawMessageKey = await crypto.subtle.exportKey("raw", messageKey);

  // Wrap the message key for each participant using ECDH
  const wrappedKeys: Record<string, string> = {};
  for (const p of participants) {
    try {
      const sharedKey = await getOrDeriveSharedKey(myUserId, p.public_key);
      const wrapIv = crypto.getRandomValues(new Uint8Array(12));
      const wrappedKey = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: wrapIv },
        sharedKey,
        rawMessageKey,
      );

      // Combine wrap IV + wrapped key
      const combined = new Uint8Array(
        wrapIv.length + wrappedKey.byteLength,
      );
      combined.set(wrapIv, 0);
      combined.set(new Uint8Array(wrappedKey), wrapIv.length);
      wrappedKeys[p.user_id] = arrayBufferToBase64(combined);
    } catch (err) {
      console.warn(`Failed to wrap key for ${p.user_id}:`, err);
    }
  }

  const envelope = {
    wrapped_keys: wrappedKeys,
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(new Uint8Array(ciphertext)),
  };

  return E2E_CHANNEL_PREFIX + btoa(JSON.stringify(envelope));
}

/**
 * Decrypt a channel-encrypted message.
 */
export async function decryptChannelMessage(
  encryptedMsg: string,
  myUserId: string,
  senderPublicKeyJwk: string,
): Promise<string> {
  if (!encryptedMsg.startsWith(E2E_CHANNEL_PREFIX)) {
    return encryptedMsg;
  }

  try {
    const envelopeJson = atob(encryptedMsg.slice(E2E_CHANNEL_PREFIX.length));
    const envelope = JSON.parse(envelopeJson) as {
      wrapped_keys: Record<string, string>;
      iv: string;
      ciphertext: string;
    };

    // Find the wrapped key for us
    const myWrappedKey = envelope.wrapped_keys[myUserId];
    if (!myWrappedKey) {
      return "🔒 [Not authorized to decrypt this message]";
    }

    // Unwrap the message key
    const wrappedPayload = base64ToArrayBuffer(myWrappedKey);
    const wrapIv = wrappedPayload.slice(0, 12);
    const wrappedKeyBytes = wrappedPayload.slice(12);

    const sharedKey = await getOrDeriveSharedKey(myUserId, senderPublicKeyJwk);
    const rawMessageKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrapIv },
      sharedKey,
      wrappedKeyBytes,
    );

    // Import the message key
    const messageKey = await crypto.subtle.importKey(
      "raw",
      rawMessageKey,
      "AES-GCM",
      false,
      ["decrypt"],
    );

    // Decrypt the message body
    const iv = base64ToArrayBuffer(envelope.iv);
    const ciphertext = base64ToArrayBuffer(envelope.ciphertext);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
      messageKey,
      ciphertext as Uint8Array<ArrayBuffer>,
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn("E2E channel decryption failed:", err);
    return "🔒 [Encrypted message — cannot decrypt]";
  }
}

export function isChannelEncrypted(content: string): boolean {
  return content.startsWith(E2E_CHANNEL_PREFIX);
}

// ─── Utilities ───

function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Clear the shared key cache (eg: when switching servers).
 */
export function clearKeyCache(): void {
  sharedKeyCache.clear();
}
