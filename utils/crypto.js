const crypto = require('crypto');
const { promisify } = require('util');

// Convert callback-based functions to promises
const randomBytes = promisify(crypto.randomBytes);

// Cache the validated key to avoid repeated processing
let cachedKey = null;

function validateKey(key) {
    if (!key) throw new Error('ENCRYPTION_KEY not set in environment');
    if (key.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(key, 'hex');
}

async function getKey() {
    if (!cachedKey) {
        cachedKey = validateKey(process.env.ENCRYPTION_KEY);
    }
    return cachedKey;
}

module.exports = {
    encrypt: async (text) => {
        try {
            const key = await getKey();
            const iv = await randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag().toString('hex');
            return `${iv.toString('hex')}:${authTag}:${encrypted}`;
        } catch (err) {
            console.error('Encryption failed:', err.message);
            throw new Error('Encryption failed');
        }
    },

    decrypt: async (text) => {
        try {
            const key = await getKey();
            const [ivHex, authTagHex, encrypted] = text.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err) {
            console.error('Decryption failed:', err.message);
            throw new Error('Decryption failed - invalid or tampered data');
        }
    }
};