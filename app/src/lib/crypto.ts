/**
 * E2E Encryption module using Web Crypto API — Sender Keys Protocol
 *
 * Architecture:
 *   Each user generates an ECDH P-256 identity key pair (for 1:1 key exchange).
 *   For group/channel encryption, we use a Sender Keys protocol:
 *
 *   1. Each sender generates a random AES-256-GCM "sender key" per channel
 *   2. The sender key is distributed to all channel members, encrypted with
 *      pairwise ECDH-derived keys (this is O(n) but happens ONCE per sender)
 *   3. Each message is encrypted with the sender's own sender key — O(1) per message
 *   4. Recipients decrypt using the cached sender key for that user
 *   5. Sender keys are rotated when membership changes (new member joins / member leaves)
 *
 * This reduces per-message overhead from O(n) wrapped keys to O(1), making
 * encrypted channels practical with hundreds of members.
 *
 * Wire formats:
 *   Direct:  `e2e::<base64(iv + ciphertext)>`
 *   Channel: `e2e-ch::<base64(JSON)>`     (legacy per-message wrapping, still decodable)
 *   SenderK: `e2e-sk::<base64(JSON{ sid, ctr, iv, ct })>`   (new sender keys format)
 */

const DB_NAME = "sivycord-e2e";
const DB_VERSION = 2;
const STORE_NAME = "keypairs";
const SK_STORE = "sender_keys";

// ─── IndexedDB helpers for key persistence ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(SK_STORE)) {
        db.createObjectStore(SK_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(key: string, store = STORE_NAME): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key: string, value: unknown, store = STORE_NAME): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    s.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(key: string, store = STORE_NAME): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    s.delete(key);
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

// ─── Sender Keys Protocol (scalable group encryption) ───

const E2E_SK_PREFIX = "e2e-sk::";
const E2E_SKD_PREFIX = "e2e-skd::";

interface SenderKeyData {
  rawKey: string;   // base64 AES-256-GCM key
  counter: number;  // monotonic message counter (anti-replay)
  keyId: string;    // random ID to detect key rotation
}

// In-memory caches: channelId:userId -> CryptoKey
const senderKeyCryptoCache = new Map<string, CryptoKey>();
const senderKeyMetaCache = new Map<string, SenderKeyData>();

/**
 * Get or create the current user's sender key for a channel.
 * Persisted in IndexedDB (sender_keys store) so it survives page reloads.
 */
export async function getOrCreateOwnSenderKey(
  userId: string,
  channelId: string,
): Promise<{ cryptoKey: CryptoKey; meta: SenderKeyData }> {
  const dbKey = `sk:${channelId}:${userId}`;
  const cacheKey = `${channelId}:${userId}`;

  // Check in-memory cache first
  const cachedKey = senderKeyCryptoCache.get(cacheKey);
  const cachedMeta = senderKeyMetaCache.get(cacheKey);
  if (cachedKey && cachedMeta) {
    return { cryptoKey: cachedKey, meta: cachedMeta };
  }

  // Check IndexedDB
  let meta = await dbGet<SenderKeyData>(dbKey, SK_STORE);
  if (!meta) {
    // Generate a new sender key
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const rawBytes = await crypto.subtle.exportKey("raw", aesKey);
    meta = {
      rawKey: arrayBufferToBase64(new Uint8Array(rawBytes)),
      counter: 0,
      keyId: crypto.randomUUID(),
    };
    await dbSet(dbKey, meta, SK_STORE);
    senderKeyCryptoCache.set(cacheKey, aesKey);
    senderKeyMetaCache.set(cacheKey, meta);
    return { cryptoKey: aesKey, meta };
  }

  // Import from stored raw key
  const rawBytes = base64ToArrayBuffer(meta.rawKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawBytes as Uint8Array<ArrayBuffer>,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  senderKeyCryptoCache.set(cacheKey, cryptoKey);
  senderKeyMetaCache.set(cacheKey, meta);
  return { cryptoKey, meta };
}

/**
 * Import a remote sender's key so we can decrypt their messages.
 */
async function importSenderKey(
  channelId: string,
  senderId: string,
  rawKeyBase64: string,
  keyId: string,
): Promise<void> {
  const dbKey = `sk:${channelId}:${senderId}`;
  const cacheKey = `${channelId}:${senderId}`;
  const meta: SenderKeyData = { rawKey: rawKeyBase64, counter: 0, keyId };

  await dbSet(dbKey, meta, SK_STORE);

  const rawBytes = base64ToArrayBuffer(rawKeyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawBytes as Uint8Array<ArrayBuffer>,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  senderKeyCryptoCache.set(cacheKey, cryptoKey);
  senderKeyMetaCache.set(cacheKey, meta);
}

/**
 * Create a sender key distribution message.
 * This encrypts OUR sender key for each participant using pairwise ECDH — O(n) once.
 * Returns a wire-format string to send to the channel.
 */
export async function createSenderKeyDistribution(
  myUserId: string,
  channelId: string,
  participants: ChannelParticipantKey[],
): Promise<string> {
  const { meta } = await getOrCreateOwnSenderKey(myUserId, channelId);

  // Encrypt our raw sender key for each participant
  const distributions: Record<string, string> = {};
  const senderKeyBytes = base64ToArrayBuffer(meta.rawKey);

  for (const p of participants) {
    if (p.user_id === myUserId) continue;
    try {
      const sharedKey = await getOrDeriveSharedKey(myUserId, p.public_key);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        sharedKey,
        senderKeyBytes as Uint8Array<ArrayBuffer>,
      );
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      distributions[p.user_id] = arrayBufferToBase64(combined);
    } catch (err) {
      console.warn(`Failed to distribute sender key to ${p.user_id}:`, err);
    }
  }

  const envelope = {
    sender: myUserId,
    channel: channelId,
    key_id: meta.keyId,
    distributions,
  };

  return E2E_SKD_PREFIX + btoa(JSON.stringify(envelope));
}

/**
 * Process an incoming sender key distribution message.
 * Decrypts the sender's key and caches it for future message decryption.
 */
export async function processSenderKeyDistribution(
  rawMsg: string,
  myUserId: string,
  senderPublicKeyJwk: string,
): Promise<boolean> {
  if (!rawMsg.startsWith(E2E_SKD_PREFIX)) return false;

  try {
    const envelope = JSON.parse(atob(rawMsg.slice(E2E_SKD_PREFIX.length))) as {
      sender: string;
      channel: string;
      key_id: string;
      distributions: Record<string, string>;
    };

    const myDistribution = envelope.distributions[myUserId];
    if (!myDistribution) return false;

    // Decrypt the sender key using our pairwise ECDH key
    const payload = base64ToArrayBuffer(myDistribution);
    const iv = payload.slice(0, 12);
    const ciphertext = payload.slice(12);

    const sharedKey = await getOrDeriveSharedKey(myUserId, senderPublicKeyJwk);
    const rawSenderKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      ciphertext,
    );

    // Store the sender's key
    const rawKeyBase64 = arrayBufferToBase64(new Uint8Array(rawSenderKey));
    await importSenderKey(envelope.channel, envelope.sender, rawKeyBase64, envelope.key_id);

    return true;
  } catch (err) {
    console.warn("Failed to process sender key distribution:", err);
    return false;
  }
}

/**
 * Check if we have a cached sender key for a user in a channel.
 */
export async function hasSenderKey(
  channelId: string,
  userId: string,
): Promise<boolean> {
  const cacheKey = `${channelId}:${userId}`;
  if (senderKeyMetaCache.has(cacheKey)) return true;
  const dbKey = `sk:${channelId}:${userId}`;
  const meta = await dbGet<SenderKeyData>(dbKey, SK_STORE);
  return meta !== undefined;
}

/**
 * Encrypt a message using sender keys — O(1) per message.
 */
export async function encryptWithSenderKey(
  plaintext: string,
  myUserId: string,
  channelId: string,
): Promise<string> {
  const { cryptoKey, meta } = await getOrCreateOwnSenderKey(myUserId, channelId);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded,
  );

  // Increment counter for anti-replay
  meta.counter++;
  const dbKey = `sk:${channelId}:${myUserId}`;
  await dbSet(dbKey, meta, SK_STORE);

  const envelope = {
    sid: myUserId,
    kid: meta.keyId,
    ctr: meta.counter,
    iv: arrayBufferToBase64(iv),
    ct: arrayBufferToBase64(new Uint8Array(ciphertext)),
  };

  return E2E_SK_PREFIX + btoa(JSON.stringify(envelope));
}

/**
 * Decrypt a sender-key-encrypted message — O(1) per message.
 */
export async function decryptWithSenderKey(
  encryptedMsg: string,
  channelId: string,
): Promise<string> {
  if (!encryptedMsg.startsWith(E2E_SK_PREFIX)) return encryptedMsg;

  try {
    const envelope = JSON.parse(atob(encryptedMsg.slice(E2E_SK_PREFIX.length))) as {
      sid: string;
      kid: string;
      ctr: number;
      iv: string;
      ct: string;
    };

    const cacheKey = `${channelId}:${envelope.sid}`;
    let cryptoKey = senderKeyCryptoCache.get(cacheKey);

    if (!cryptoKey) {
      // Try loading from IndexedDB
      const dbKey = `sk:${channelId}:${envelope.sid}`;
      const meta = await dbGet<SenderKeyData>(dbKey, SK_STORE);
      if (!meta || meta.keyId !== envelope.kid) {
        return "🔒 [Missing sender key — waiting for key distribution]";
      }
      const rawBytes = base64ToArrayBuffer(meta.rawKey);
      cryptoKey = await crypto.subtle.importKey(
        "raw",
        rawBytes as Uint8Array<ArrayBuffer>,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      senderKeyCryptoCache.set(cacheKey, cryptoKey);
    }

    const iv = base64ToArrayBuffer(envelope.iv);
    const ct = base64ToArrayBuffer(envelope.ct);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
      cryptoKey,
      ct as Uint8Array<ArrayBuffer>,
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn("Sender key decryption failed:", err);
    return "🔒 [Encrypted message — cannot decrypt]";
  }
}

/**
 * Rotate sender key for a channel (call when membership changes).
 * Deletes the old key so a new one will be generated on next send.
 */
export async function rotateSenderKey(
  userId: string,
  channelId: string,
): Promise<void> {
  const dbKey = `sk:${channelId}:${userId}`;
  const cacheKey = `${channelId}:${userId}`;
  await dbDelete(dbKey, SK_STORE);
  senderKeyCryptoCache.delete(cacheKey);
  senderKeyMetaCache.delete(cacheKey);
}

/** Check if a raw message is a sender key distribution */
export function isSenderKeyDistribution(content: string): boolean {
  return content.startsWith(E2E_SKD_PREFIX);
}

/** Check if a raw message is sender-key encrypted */
export function isSenderKeyMessage(content: string): boolean {
  return content.startsWith(E2E_SK_PREFIX);
}

// ─── Legacy channel encryption (kept for backwards compatibility) ───

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
  return (
    content.startsWith(E2E_CHANNEL_PREFIX) ||
    content.startsWith(E2E_SK_PREFIX) ||
    content.startsWith(E2E_SKD_PREFIX)
  );
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
  senderKeyCryptoCache.clear();
  senderKeyMetaCache.clear();
}
