require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Token = require('./models/Token');
const TokenManager = require('./tokenManager');
const ModAction = require('./models/modAction');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/streammanager', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Connection event handlers
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

// Authentication Middleware
function authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

function checkChannelAccess(req, res, next) {
    const channelName = req.params.channelName;
    const { role, channel } = req.user;

    if (role === 'admin') return next();
    if (channel === channelName) return next();

    return res.status(403).json({ error: 'Access denied' });
}

// Routes
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD) {

        const token = jwt.sign(
            { role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.json({
            token,
            role: 'admin'
        });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
});

// Twitch OAuth Routes
app.get('/auth/twitch', (req, res) => {
    // Determine if this is an admin connecting a channel or streamer login
    const isAdminConnecting = req.headers.referer?.includes('/hub');
    const state = isAdminConnecting ? 'admin_connect' : 'streamer_login';

    const scopes = [
        'moderator:manage:banned_users',
        'channel:manage:broadcast',
        'channel:read:subscriptions',
        'channel:manage:moderators',
        'channel:read:vips',
        'channel:manage:vips',
        'channel:edit:commercial'
    ].join('+');

    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code` +
        `&client_id=${process.env.TWITCH_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.TWITCH_REDIRECT_URI)}` +
        `&scope=${scopes}` +
        `&state=${state}` +
        `&force_verify=true`;

    res.redirect(authUrl);
});

// Twitch OAuth Callback
app.get('/auth/twitch/callback', async (req, res) => {
    try {
        const { code, state } = req.query;

        // 1. Exchange code for tokens
        const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.TWITCH_REDIRECT_URI
            },
            timeout: 5000
        });

        // 2. Get channel info
        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${tokenResponse.data.access_token}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            },
            timeout: 5000
        });

        if (!userResponse.data.data?.length) {
            throw new Error('No channel data returned from Twitch');
        }

        const channelInfo = userResponse.data.data[0];

        // 3. Handle based on state
        if (state === 'admin_connect') {
            // ADMIN CONNECTING A CHANNEL
            const tokenManager = new TokenManager(channelInfo.login);
            await tokenManager.saveTokens(tokenResponse.data, channelInfo);

            return res.redirect('/hub');
        } else {
            // STREAMER LOGIN
            const token = jwt.sign(
                {
                    role: 'streamer',
                    channel: channelInfo.login
                },
                process.env.JWT_SECRET,
                { expiresIn: '8h' }
            );

            // Use a login-success page to set tokens securely
            return res.redirect(`/login-success?token=${token}&channel=${channelInfo.login}`);
        }
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});

// Login success page to set tokens
app.get('/login-success', (req, res) => {
    res.send(`
        <html>
            <body>
                <script>
                    localStorage.setItem('authToken', '${req.query.token}');
                    localStorage.setItem('userRole', 'streamer');
                    localStorage.setItem('channelName', '${req.query.channel}');
                    window.location.href = '/c/${req.query.channel}';
                </script>
            </body>
        </html>
    `);
});

// Channel List
app.get('/api/channels', authenticate, async (req, res) => {
    try {
        // Only admins can list all channels
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied' });
        }

        const channels = await Token.aggregate([
            {
                $project: {
                    _id: 0,
                    id: '$channelData.id',
                    login: '$channelData.login',
                    display_name: '$channelData.display_name',
                    profile_image_url: '$channelData.profile_image_url',
                    broadcaster_type: '$channelData.broadcaster_type',
                    connectedAt: '$channelData.connectedAt',
                    expiresAt: 1,
                    status: {
                        $cond: {
                            if: { $gt: ['$expiresAt', new Date()] },
                            then: 'connected',
                            else: 'expired'
                        }
                    },
                    refreshAt: {
                        $subtract: ['$expiresAt', 5 * 60 * 1000]
                    }
                }
            },
            { $sort: { connectedAt: -1 } }
        ]);

        res.json(channels);
    } catch (error) {
        console.error('Channel list error:', error);
        res.status(500).json({
            error: 'Failed to fetch channels',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Channel Actions
app.post('/api/:channel/ban', authenticate, checkChannelAccess, async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.post('https://api.twitch.tv/helix/moderation/bans', {
            data: {
                user_id: req.body.userId,
                reason: req.body.reason || '',
                duration: 0 // Permanent ban
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
            actionType: 'ban',
            targetUser: req.body.userId,
            reason: req.body.reason
        });

        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error);
    }
});

app.post('/api/:channel/timeout', authenticate, checkChannelAccess, async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.post('https://api.twitch.tv/helix/moderation/bans', {
            data: {
                user_id: req.body.userId,
                reason: req.body.reason || '',
                duration: parseInt(req.body.duration) || 300
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
            duration: req.body.duration,
            reason: req.body.reason
        });

        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error);
    }
});

// Moderator Management
app.post('/api/:channel/mod', authenticate, checkChannelAccess, async (req, res) => {
    await handleModAction(req, res, 'mod', {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unmod', authenticate, checkChannelAccess, async (req, res) => {
    await handleModAction(req, res, 'unmod', {
        user_id: req.body.userId
    });
});

// VIP Management
app.post('/api/:channel/vip', authenticate, checkChannelAccess, async (req, res) => {
    await handleModAction(req, res, 'vip', {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unvip', authenticate, checkChannelAccess, async (req, res) => {
    await handleModAction(req, res, 'unvip', {
        user_id: req.body.userId
    });
});

// Commercials
app.post('/api/:channel/commercial', authenticate, checkChannelAccess, async (req, res) => {
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

// Stream Info
app.get('/api/:channel/stream-info', authenticate, checkChannelAccess, async (req, res) => {
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

app.patch('/api/:channel/stream-info', authenticate, checkChannelAccess, async (req, res) => {
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

// Mod Stats
app.get('/api/:channel/mod-stats', authenticate, checkChannelAccess, async (req, res) => {
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

// User ID Lookup
app.get('/api/:channel/user-id', authenticate, checkChannelAccess, async (req, res) => {
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

// Static File Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/hub', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public/hub.html'));
});

app.get('/c/:channel', authenticate, (req, res) => {
    // Check if user has access to this channel
    if (req.user.role !== 'admin' && req.user.channel !== req.params.channel) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public/channel.html'));
});

// Helper Functions
async function handleModAction(req, res, action, body = null, params = {}) {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        let url, method;
        switch (action) {
            case 'mod':
                url = 'https://api.twitch.tv/helix/moderation/moderators';
                method = 'post';
                params = { broadcaster_id: broadcasterId, user_id: req.body.userId };
                break;
            case 'unmod':
                url = 'https://api.twitch.tv/helix/moderation/moderators';
                method = 'delete';
                params = { broadcaster_id: broadcasterId, user_id: req.body.userId };
                break;
            case 'vip':
                url = 'https://api.twitch.tv/helix/channels/vips';
                method = 'post';
                params = { broadcaster_id: broadcasterId, user_id: req.body.userId };
                break;
            case 'unvip':
                url = 'https://api.twitch.tv/helix/channels/vips';
                method = 'delete';
                params = { broadcaster_id: broadcasterId, user_id: req.body.userId };
                break;
            default:
                throw new Error('Invalid action type');
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

        // Log the mod action
        await logModAction({
            channelId: broadcasterId,
            moderatorId: broadcasterId,
            moderatorName: req.params.channel,
            actionType: action,
            targetUser: req.body.userId
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

async function logModAction(data) {
    try {
        await ModAction.create({
            channelId: data.channelId,
            moderatorId: data.moderatorId,
            moderatorName: data.moderatorName,
            actionType: data.actionType,
            targetUser: data.targetUser,
            duration: data.duration,
            reason: data.reason,
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

    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
        error: 'API request failed',
        details: error.response?.data || error.message
    });
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Twitch Client ID: ${process.env.TWITCH_CLIENT_ID}`);
});