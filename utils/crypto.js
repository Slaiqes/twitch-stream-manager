const crypto = require('crypto');

function validateKey(key) {
    if (!key) throw new Error('ENCRYPTION_KEY not set in environment');
    if (key.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(key, 'hex');
}

module.exports = {
    encrypt: (text) => {
        try {
            const key = validateKey(process.env.ENCRYPTION_KEY);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
        } catch (err) {
            console.error('Encryption failed:', err.message);
            throw err;
        }
    },

    decrypt: (text) => {
        try {
            const key = validateKey(process.env.ENCRYPTION_KEY);
            const [ivHex, encrypted] = text.split(':');
            const iv = Buffer.from(ivHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err) {
            console.error('Decryption failed:', err.message);
            throw err;
        }
    }
};

