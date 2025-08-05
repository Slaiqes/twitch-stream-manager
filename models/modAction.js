const mongoose = require('mongoose');

const modActionSchema = new mongoose.Schema({
    channelId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    moderatorName: { type: String, required: true },
    actionType: { type: String, required: true, enum: ['ban', 'timeout', 'mod', 'vip', 'unmod', 'unvip'] },
    targetUser: { type: String },
    duration: { type: Number },
    reason: { type: String },
    timestamp: { type: Date, default: Date.now }
});

modActionSchema.index({ channelId: 1, timestamp: -1 });
modActionSchema.index({ moderatorId: 1 });

module.exports = mongoose.model('ModAction', modActionSchema);