const mongoose = require('mongoose');

const ModActionSchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true,
        index: true
    },
    moderatorId: {
        type: String,
        required: true,
        index: true
    },
    moderatorName: {
        type: String,
        required: true,
        trim: true
    },
    actionType: {
        type: String,
        required: true,
        enum: ['ban', 'timeout', 'mod', 'vip', 'unmod', 'unvip'],
        index: true
    },
    targetUser: {
        type: String,
        required: function () {
            return ['ban', 'timeout', 'mod', 'unmod', 'vip', 'unvip'].includes(this.actionType);
        },
        trim: true
    },
    duration: {
        type: Number,
        required: function () {
            return this.actionType === 'timeout';
        },
        min: [1, 'Duration must be at least 1 second'],
        max: [1209600, 'Duration cannot exceed 2 weeks']
    },
    reason: {
        type: String,
        trim: true,
        maxlength: [500, 'Reason cannot exceed 500 characters']
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: -1 // Descending index
    },
    metadata: {
        ipAddress: { type: String, select: false },
        userAgent: { type: String, select: false }
    }
}, {
    timestamps: true
});

// Compound indexes
ModActionSchema.index({ channelId: 1, moderatorId: 1 });
ModActionSchema.index({ channelId: 1, actionType: 1, timestamp: -1 });

// Pre-save hook for validation
ModActionSchema.pre('save', function (next) {
    if (this.actionType === 'timeout' && (!this.duration || this.duration <= 0)) {
        throw new Error('Timeout duration is required and must be positive');
    }
    next();
});

// Static methods for analytics
ModActionSchema.statics = {
    async getModerationStats(channelId, days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return this.aggregate([
            {
                $match: {
                    channelId,
                    timestamp: { $gte: startDate },
                    actionType: { $in: ['ban', 'timeout'] }
                }
            },
            {
                $group: {
                    _id: "$moderatorId",
                    moderatorName: { $first: "$moderatorName" },
                    totalActions: { $sum: 1 },
                    bans: {
                        $sum: { $cond: [{ $eq: ["$actionType", "ban"] }, 1, 0] }
                    },
                    timeouts: {
                        $sum: { $cond: [{ $eq: ["$actionType", "timeout"] }, 1, 0] }
                    },
                    lastAction: { $max: "$timestamp" }
                }
            },
            { $sort: { totalActions: -1 } }
        ]);
    }
};

module.exports = mongoose.model('ModAction', ModActionSchema);