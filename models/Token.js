const mongoose = require('mongoose');

const TokenSchema = new mongoose.Schema({
    channelName: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    accessToken: {
        type: String,
        required: true // Changed from false to true
    },
    refreshToken: {
        type: String,
        required: true // Changed from false to true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    scope: {
        type: [String],
        required: true
    },
    tokenType: {
        type: String,
        required: true
    },
    channelData: {
        type: Object,
        required: true
    }
}, {
    timestamps: true
});

// Keep these important methods
TokenSchema.methods.isExpired = function () {
    return this.expiresAt <= new Date();
};

TokenSchema.methods.needsRefresh = function () {
    const now = new Date();
    const refreshTime = new Date(this.expiresAt.getTime() - 5 * 60 * 1000);
    return now >= refreshTime;
};

// Add this if implementing encryption
TokenSchema.methods.encryptToken = function (text) {
    if (!process.env.ENCRYPTION_KEY) return text;
    const crypto = require('crypto');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc',
        Buffer.from(process.env.ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

TokenSchema.methods.decryptToken = function (text) {
    if (!process.env.ENCRYPTION_KEY) return text;
    const crypto = require('crypto');
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encrypted = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc',
        Buffer.from(process.env.ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};

module.exports = mongoose.model('Token', TokenSchema);