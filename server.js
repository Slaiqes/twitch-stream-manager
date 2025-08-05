require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');  // Corrected mongoose import
const TokenManager = require('./tokenManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Corrected MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/streammanager', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,  // Added timeout settings
    socketTimeoutMS: 45000
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);  // Exit process on connection failure
    });

// Add connection event handlers
mongoose.connection.on('connected', () => {
    console.log(`Mongoose connected to ${mongoose.connection.host}`);
});

mongoose.connection.on('error', (err) => {
    console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected');
});
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.post('/api/login', (req, res) => {
    if (req.body.username === process.env.ADMIN_USERNAME &&
        req.body.password === process.env.ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Twitch OAuth
app.get('/auth/twitch', (req, res) => {
    const scopes = [
        'analytics:read:extensions',
        'clips:edit',
        'bits:read',
        'analytics:read:games',
        'user:edit:broadcast',
        'user:read:broadcast',
        'chat:read',
        'chat:edit',
        'channel:moderate',
        'channel:read:subscriptions',
        'moderation:read',
        'channel:read:redemptions',
        'channel:edit:commercial',
        'channel:manage:extensions',
        'channel:manage:broadcast',
        'channel:manage:redemptions',
        'channel:read:editors',
        'channel:manage:videos',
        'user:read:subscriptions',
        'channel:manage:polls',
        'channel:manage:predictions',
        'channel:read:polls',
        'channel:read:predictions',
        'channel:read:goals',
        'moderator:read:automod_settings',
        'moderator:manage:automod_settings',
        'moderator:manage:banned_users',
        'moderator:read:blocked_terms',
        'moderator:manage:blocked_terms',
        'moderator:read:chat_settings',
        'moderator:manage:chat_settings',
        'moderator:manage:announcements',
        'moderator:manage:chat_messages',
        'channel:manage:moderators',
        'channel:read:vips',
        'channel:manage:vips',
        'moderator:read:shield_mode',
        'moderator:manage:shield_mode',
        'moderator:read:shoutouts',
        'moderator:manage:shoutouts',
        'moderator:read:followers',
        'channel:read:guest_star',
        'channel:manage:guest_star',
        'moderator:read:guest_star',
        'moderator:manage:guest_star',
        'channel:bot',
        'user:bot',
        'user:read:chat',
        'channel:manage:ads',
        'channel:read:ads',
        'user:read:moderated_channels',
        'moderator:read:unban_requests',
        'moderator:manage:unban_requests',
        'moderator:read:suspicious_users',
        'moderator:manage:warnings'

    ].join('+');

    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code` +
        `&client_id=${process.env.TWITCH_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.TWITCH_REDIRECT_URI)}` +
        `&scope=${scopes}` +
        `&force_verify=true`;

    res.redirect(authUrl);
});

// Twitch callback
app.get('/auth/twitch/callback', async (req, res) => {
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                code: req.query.code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.TWITCH_REDIRECT_URI
            }
        });

        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${response.data.access_token}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            }
        });

        const channelData = userResponse.data.data[0];
        const tokenManager = new TokenManager(channelData.login);
        await tokenManager.saveTokens(response.data);

        // Save channel info
        fs.writeFileSync(
            path.join(__dirname, 'channel_tokens', `${channelData.login}_info.json`),
            JSON.stringify({
                ...channelData,
                connectedAt: Date.now()
            })
        );

        res.redirect(`/channel.html?channel=${channelData.login}`);
    } catch (error) {
        console.error('OAuth error:', error.response?.data || error.message);
        res.redirect('/hub.html?error=auth_failed');
    }
});

// Channel endpoints
app.get('/api/channels', (req, res) => {
    const tokenDir = path.join(__dirname, 'channel_tokens');
    if (!fs.existsSync(tokenDir)) return res.json([]);

    const channels = fs.readdirSync(tokenDir)
        .filter(file => file.endsWith('_info.json'))
        .map(file => {
            const data = JSON.parse(fs.readFileSync(path.join(tokenDir, file)));
            const tokenFile = file.replace('_info.json', '.json');
            const tokens = fs.existsSync(path.join(tokenDir, tokenFile)) ?
                JSON.parse(fs.readFileSync(path.join(tokenDir, tokenFile))) : null;

            return {
                ...data,
                status: tokens?.expiresAt > Date.now() ? 'connected' : 'expired',
                expiresAt: tokens?.expiresAt,
                refreshAt: tokens?.expiresAt - 300000
            };
        });

    res.json(channels);
});
app.get('/api/:channel/user-id', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();

        const response = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            },
            params: { login: req.query.username }
        });

        if (response.data.data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ userId: response.data.data[0].id });
    } catch (error) {
        console.error('User ID lookup error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to lookup user ID' });
    }
});
// Channel actions
app.post('/api/:channel/ban', async (req, res) => {
    try {
        if (!req.body.userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.post('https://api.twitch.tv/helix/moderation/bans', {
            data: {
                user_id: req.body.userId,
                reason: req.body.reason || '',
                duration: req.body.duration || 0
            }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: {
                broadcaster_id: broadcasterId,
                moderator_id: broadcasterId
            }
        });

        // Log the ban action
        await logModAction({
            channelId: broadcasterId,
            moderatorId: broadcasterId,
            moderatorName: req.params.channel,
            actionType: 'ban',
            targetUser: req.body.userId,
            reason: req.body.reason
        });

        res.json({ success: true, data: response.data });
    } catch (error) {
        handleApiError(res, error);
    }
});

app.post('/api/:channel/unban', async (req, res) => {
    await handleModAction(req, res, 'unban', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/timeout', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.post('https://api.twitch.tv/helix/moderation/bans', {
            data: {
                user_id: req.body.userId,
                reason: req.body.reason || '',
                duration: parseInt(req.body.duration) || 300 // Default to 5 minutes
            }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: {
                broadcaster_id: broadcasterId,
                moderator_id: broadcasterId
            }
        });
        await logModAction({
            channelId: broadcasterId,
            moderatorId: broadcasterId,
            moderatorName: req.params.channel,
            actionType: 'timeout',
            targetUser: req.body.userId,
            duration: req.body.duration
        });
        res.json({ success: true, data: response.data });
    } catch (error) {
        handleApiError(res, error);
    }
});

app.post('/api/:channel/untimeout', async (req, res) => {
    await handleModAction(req, res, 'untimeout', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/mod', async (req, res) => {
    await handleModAction(req, res, 'mod', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unmod', async (req, res) => {
    await handleModAction(req, res, 'unmod', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/vip', async (req, res) => {
    await handleModAction(req, res, 'vip', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unvip', async (req, res) => {
    await handleModAction(req, res, 'unvip', null, {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/commercial', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.post('https://api.twitch.tv/helix/channels/commercial', {
            length: req.body.length || 30
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: { broadcaster_id: broadcasterId }
        });

        res.json({ success: true, data: response.data });
    } catch (error) {
        handleApiError(res, error);
    }
});

// Stream management
app.get('/api/:channel/stream-info', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const [channelResponse, streamResponse] = await Promise.all([
            axios.get('https://api.twitch.tv/helix/channels', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                },
                params: { broadcaster_id: broadcasterId }
            }),
            axios.get('https://api.twitch.tv/helix/streams', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                },
                params: { user_id: broadcasterId }
            })
        ]);

        res.json({
            title: channelResponse.data.data[0]?.title,
            category: channelResponse.data.data[0]?.game_name,
            isLive: streamResponse.data.data.length > 0,
            startedAt: streamResponse.data.data[0]?.started_at
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

app.patch('/api/:channel/stream-info', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.patch('https://api.twitch.tv/helix/channels', {
            title: req.body.title,
            game_id: req.body.gameId
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: { broadcaster_id: broadcasterId }
        });

        res.json({ success: true, data: response.data });
    } catch (error) {
        handleApiError(res, error);
    }
});
// Add this with your other API routes in server.js
app.get('/api/:channel/mod-stats', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);
        const days = parseInt(req.query.days) || 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const stats = await ModAction.aggregate([
            {
                $match: {
                    channelId: broadcasterId,
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
                        $sum: {
                            $cond: [{ $eq: ["$actionType", "ban"] }, 1, 0]
                        }
                    },
                    timeouts: {
                        $sum: {
                            $cond: [{ $eq: ["$actionType", "timeout"] }, 1, 0]
                        }
                    },
                    lastAction: { $max: "$timestamp" }
                }
            },
            { $sort: { totalActions: -1 } },
            { $limit: 50 }
        ]);

        res.json(stats);
    } catch (error) {
        handleApiError(res, error);
    }
});
// Helper functions
async function handleModAction(req, res, action, body = null, params = {}) {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        // Add broadcaster_id as moderator_id for all actions
        params.broadcaster_id = broadcasterId;
        params.moderator_id = broadcasterId;

        let url, method;
        switch (action) {
            case 'ban':
                url = 'https://api.twitch.tv/helix/moderation/bans';
                method = 'post';
                params.broadcaster_id = broadcasterId;
                params.moderator_id = broadcasterId;
                break;
            case 'unban':
                url = 'https://api.twitch.tv/helix/moderation/bans';
                method = 'delete';
                params.broadcaster_id = broadcasterId;
                params.moderator_id = broadcasterId;
                break;
            case 'mod':
                url = 'https://api.twitch.tv/helix/moderation/moderators';
                method = 'post';
                params.broadcaster_id = broadcasterId;
                break;
            case 'unmod':
                url = 'https://api.twitch.tv/helix/moderation/moderators';
                method = 'delete';
                params.broadcaster_id = broadcasterId;
                break;
            case 'vip':
                url = 'https://api.twitch.tv/helix/channels/vips';
                method = 'post';
                params.broadcaster_id = broadcasterId;
                break;
            case 'unvip':
                url = 'https://api.twitch.tv/helix/channels/vips';
                method = 'delete';
                params.broadcaster_id = broadcasterId;
                break;
        }

        const response = await axios({
            method,
            url,
            data: body,
            params,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, data: response.data });
    } catch (error) {
        handleApiError(res, error);
    }
}

async function getUserId(username, accessToken) {
    const response = await axios.get('https://api.twitch.tv/helix/users', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID
        },
        params: { login: username }
    });
    return response.data.data[0]?.id;
}
const ModAction = require('./models/modAction'); // Ensure this path is correct

async function logModAction(data) {
    try {
        await ModAction.create({
            channelId: data.channelId,
            moderatorId: data.moderatorId,
            moderatorName: data.moderatorName,
            actionType: data.actionType,
            targetUser: data.targetUser,
            duration: data.duration,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Failed to log mod action:', error);
    }
}
function handleApiError(res, error) {
    console.error('API error:', {
        message: error.message,
        response: error.response?.data,
        stack: error.stack
    });

    res.status(500).json({
        error: 'API request failed',
        details: error.response?.data || error.message
    });
}

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));