const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Derives a 256-bit key from the ENCRYPTION_KEY environment variable.
 * Uses SHA-256 to ensure consistent key length regardless of input.
 */
function getKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Set it to a strong random string before starting the application.'
    );
  }
  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param {string} plaintext - The text to encrypt
 * @returns {{ encrypted: string, iv: string, authTag: string }} - Hex-encoded encrypted data, IV, and auth tag
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 *
 * @param {string} encryptedHex - Hex-encoded encrypted data
 * @param {string} ivHex - Hex-encoded initialization vector
 * @param {string} authTagHex - Hex-encoded authentication tag
 * @returns {string} - The decrypted plaintext
 */
function decrypt(encryptedHex, ivHex, authTagHex) {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
