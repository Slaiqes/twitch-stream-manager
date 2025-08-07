const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const TokenSchema = new mongoose.Schema({
    channelName: {
        type: String,
        required: true,
        unique: true,
        index: true,
        validate: {
            validator: (v) => /^[a-zA-Z0-9_]{4,25}$/.test(v),
            message: 'Invalid channel name format'
        }
    },
    accessToken: {
        type: String,
        required: true,
        select: false // Don't return this field by default
    },
    refreshToken: {
        type: String,
        required: true,
        select: false
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: '0s' } // Auto-remove expired tokens
    },
    scope: {
        type: [String],
        required: true,
        validate: {
            validator: (v) => Array.isArray(v) && v.length > 0,
            message: 'At least one scope is required'
        }
    },
    tokenType: {
        type: String,
        required: true,
        enum: ['bearer'],
        default: 'bearer'
    },
    followerCount: {
        type: Number,
        default: 0
    },
    followerCountUpdated: {
        type: Date,
        default: Date.now
    },
    channelData: {
        type: {
            id: { type: String, required: true },
            login: { type: String, required: true },
            display_name: { type: String, required: true },
            profile_image_url: { type: String },
            broadcaster_type: { type: String },
            connectedAt: { type: Date, default: Date.now },
            status: {
                type: String,
                enum: ['connected', 'expired', 'revoked'],
                default: 'connected'
            }
        },
        required: true
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            // Never include sensitive tokens in JSON output
            delete ret.accessToken;
            delete ret.refreshToken;
            return ret;
        }
    }
});

// Pre-save hook to encrypt tokens
TokenSchema.pre('save', async function (next) {
    if (this.isModified('accessToken') && !this.accessToken.startsWith('enc:')) {
        this.accessToken = 'enc:' + await encrypt(this.accessToken);
    }
    if (this.isModified('refreshToken') && !this.refreshToken.startsWith('enc:')) {
        this.refreshToken = 'enc:' + await encrypt(this.refreshToken);
    }
    next();
});

// Static methods
TokenSchema.statics = {
    async findByChannel(channelName) {
        return this.findOne({ channelName })
            .select('+accessToken +refreshToken') // Include sensitive fields
            .exec();
    }
};

// Instance methods
TokenSchema.methods = {
    isExpired() {
        return this.expiresAt <= new Date();
    },
    needsRefresh() {
        const refreshThreshold = new Date(this.expiresAt.getTime() - 5 * 60 * 1000);
        return new Date() >= refreshThreshold;
    },
    async getAccessToken() {
        if (!this.accessToken.startsWith('enc:')) {
            throw new Error('Token not encrypted');
        }
        return decrypt(this.accessToken.substring(4));
    },
    async getRefreshToken() {
        if (!this.refreshToken.startsWith('enc:')) {
            throw new Error('Token not encrypted');
        }
        return decrypt(this.refreshToken.substring(4));
    }
};

module.exports = mongoose.model('Token', TokenSchema);