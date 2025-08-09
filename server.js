require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Token = require('./models/Token');
const TokenManager = require('./tokenManager');
const ModAction = require('./models/modAction');
const fs = require('fs');
const cookieParser = require('cookie-parser');

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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store');
    }
}));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
});

// Authentication Middleware
function authenticate(req, res, next) {
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        console.log('No token found');
        if (req.accepts('html')) {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;

        // For channel pages (/c/username)
        if (req.path.startsWith('/c/')) {
            const channelName = req.path.split('/c/')[1].split('/')[0].replace('.html', '');

            // Allow access if:
            // - User is admin OR
            // - User is the channel owner
            if (decoded.role !== 'admin' && decoded.channel !== channelName) {
                console.log(`Access denied to channel ${channelName}`);
                return res.redirect('/login');
            }
        }

        next();
    } catch (err) {
        console.error('Token verification failed:', err);
        res.clearCookie('token');
        return req.accepts('html')
            ? res.redirect('/login')
            : res.status(401).json({ error: 'Invalid token' });
    }
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

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000
        });

        return res.json({
            token,
            role: 'admin'
        });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
});

// Twitch OAuth
app.get('/auth/twitch', (req, res) => {
    const scopes = [
        'moderator:read:followers',
        'channel:read:stream_key',
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
        `&force_verify=true`;

    res.redirect(authUrl);
});

app.get('/auth/twitch/callback', async (req, res) => {
    try {
        const { code } = req.query;

        // Exchange code for tokens
        const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.TWITCH_REDIRECT_URI
            }
        });

        // Get user info
        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${tokenResponse.data.access_token}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            }
        });

        const channelInfo = userResponse.data.data[0];

        // Save tokens to database
        const tokenManager = new TokenManager(channelInfo.login);
        await tokenManager.saveTokens(tokenResponse.data, channelInfo);

        // Create session token
        const token = jwt.sign(
            {
                role: 'streamer',
                channel: channelInfo.login,
                userId: channelInfo.id
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Set cookie and redirect
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            domain: 'localhost',
            maxAge: 8 * 60 * 60 * 1000
        });

        // Simple redirect - client will verify auth
        res.redirect(`/c/${channelInfo.login}`);

    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});

// Channel Route - Must be authenticated
app.get('/c/:channel', authenticate, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/channel.html'));
});

// Auth Verification Endpoint
app.get('/api/verify-auth', authenticate, (req, res) => {
    res.json({
        authenticated: true,
        user: req.user
    });
});

// Static Files and 404
app.get('/:page', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, 'public', `${page}.html`);

    if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
    }

    res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});


// User ID Lookup
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


// Channel List Endpoint
app.get('/api/channels', authenticate, async (req, res) => {
    try {
        console.log('Fetching channels for user:', req.user);

        // Only admin can list all channels
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // Get all channels from database
        const tokens = await Token.find().lean();

        // Fetch additional info for each channel
        const channels = await Promise.all(tokens.map(async (token) => {
            const tokenManager = new TokenManager(token.channelName);
            const accessToken = await tokenManager.getAccessToken();
            const broadcasterId = token.channelData.id;

            try {
                // Get both followers and stream status in parallel
                const [followersResponse, streamResponse] = await Promise.all([
                    axios.get('https://api.twitch.tv/helix/channels/followers', {
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

                return {
                    id: token.channelData.id,
                    login: token.channelData.login,
                    display_name: token.channelData.display_name,
                    profile_image_url: token.channelData.profile_image_url,
                    broadcaster_type: token.channelData.broadcaster_type,
                    connectedAt: token.channelData.connectedAt,
                    expiresAt: token.expiresAt,
                    followers: followersResponse.data.total || 0,
                    status: token.expiresAt > new Date() ? 'connected' : 'expired',
                    refreshAt: new Date(token.expiresAt.getTime() - 5 * 60 * 1000),
                    isLive: streamResponse.data.data.length > 0,
                    streamData: streamResponse.data.data[0] || null
                };
            } catch (error) {
                console.error(`Error fetching data for ${token.channelName}:`, error);
                return {
                    ...token,
                    followers: 0,
                    isLive: false,
                    status: 'error'
                };
            }
        }));

        // Sort by connection date (newest first)
        channels.sort((a, b) => b.connectedAt - a.connectedAt);

        res.json(channels);

    } catch (error) {
        console.error('Channel list error:', error);
        res.status(500).json({
            error: 'Failed to fetch channels',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Add this to server.js
app.get('/api/channels/:channel', authenticate, async (req, res) => {
    try {
        const channelName = req.params.channel;

        // Only admin can access any channel, others can only access their own
        if (req.user.role !== 'admin' && req.user.channel !== channelName) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Get channel from database
        const token = await Token.findOne({ channelName }).lean();
        if (!token) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        const tokenManager = new TokenManager(channelName);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = token.channelData.id;

        // Get both followers and stream status in parallel
        const [followersResponse, streamResponse] = await Promise.all([
            axios.get('https://api.twitch.tv/helix/channels/followers', {
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
            id: token.channelData.id,
            login: token.channelData.login,
            display_name: token.channelData.display_name,
            profile_image_url: token.channelData.profile_image_url,
            broadcaster_type: token.channelData.broadcaster_type,
            connectedAt: token.channelData.connectedAt,
            expiresAt: token.expiresAt,
            followers: followersResponse.data.total || 0,
            status: token.expiresAt > new Date() ? 'connected' : 'expired',
            refreshAt: new Date(token.expiresAt.getTime() - 5 * 60 * 1000),
            isLive: streamResponse.data.data.length > 0,
            streamData: streamResponse.data.data[0] || null
        });

    } catch (error) {
        console.error('Channel data error:', error);
        res.status(500).json({
            error: 'Failed to fetch channel data',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Channel Actions
app.post('/api/:channel/ban', async (req, res) => {
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

app.post('/api/:channel/unban', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.delete('https://api.twitch.tv/helix/moderation/bans', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: {
                broadcaster_id: broadcasterId,
                moderator_id: broadcasterId,
                user_id: req.body.userId
            }
        });

        await logModAction({
            channelId: broadcasterId,
            moderatorId: broadcasterId,
            moderatorName: req.params.channel,
            actionType: 'unban',
            targetUser: req.body.userId
        });

        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error);
    }
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

// Untimeout User
app.post('/api/:channel/untimeout', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const response = await axios.delete('https://api.twitch.tv/helix/moderation/bans', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            },
            params: {
                broadcaster_id: broadcasterId,
                moderator_id: broadcasterId,
                user_id: req.body.userId
            }
        });

        await logModAction({
            channelId: broadcasterId,
            moderatorId: broadcasterId,
            moderatorName: req.params.channel,
            actionType: 'untimeout',
            targetUser: req.body.userId
        });

        res.json({ success: true });
    } catch (error) {
        handleApiError(res, error);
    }
});

// Moderator Management
app.post('/api/:channel/mod', async (req, res) => {
    await handleModAction(req, res, 'mod', {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unmod', async (req, res) => {
    await handleModAction(req, res, 'unmod', {
        user_id: req.body.userId
    });
});

// VIP Management
app.post('/api/:channel/vip', async (req, res) => {
    await handleModAction(req, res, 'vip', {
        user_id: req.body.userId
    });
});

app.post('/api/:channel/unvip', async (req, res) => {
    await handleModAction(req, res, 'unvip', {
        user_id: req.body.userId
    });
});

// Commercials
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

// Stream Info
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

        const channelData = channelResponse.data.data[0];
        const streamData = streamResponse.data.data[0];

        res.json({
            title: channelData?.title || '',
            category: channelData?.game_name || '',
            isLive: !!streamData, // This should be true if stream exists
            startedAt: streamData?.started_at || null
        });
    } catch (error) {
        console.error('Error fetching stream info:', error);
        res.status(500).json({
            error: 'Failed to fetch stream info',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


app.get('/api/:channel/search-categories', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const query = req.query.query;

        const response = await axios.get('https://api.twitch.tv/helix/search/categories', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            },
            params: { query }
        });

        res.json(response.data.data.map(c => ({ id: c.id, name: c.name })));
    } catch (error) {
        handleApiError(res, error);
    }
});

// Update the stream-info PATCH route
app.patch('/api/:channel/stream-info', async (req, res) => {
    try {
        const tokenManager = new TokenManager(req.params.channel);
        const accessToken = await tokenManager.getAccessToken();
        const broadcasterId = await getUserId(req.params.channel, accessToken);

        const updateData = {
            title: req.body.title
        };

        // Only update game if game_name was provided and not empty
        if (req.body.game_name && req.body.game_name.trim() !== '') {
            const searchResponse = await axios.get('https://api.twitch.tv/helix/search/categories', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                },
                params: {
                    query: req.body.game_name,
                    first: 1
                }
            });

            if (searchResponse.data.data.length > 0) {
                updateData.game_id = searchResponse.data.data[0].id;
            } else {
                return res.status(400).json({
                    error: 'Category not found',
                    details: `Could not find category "${req.body.game_name}"`
                });
            }
        }

        const response = await axios.patch('https://api.twitch.tv/helix/channels', updateData, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            params: { broadcaster_id: broadcasterId }
        });

        // Get the current channel info to return the actual category name
        const channelResponse = await axios.get('https://api.twitch.tv/helix/channels', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            },
            params: { broadcaster_id: broadcasterId }
        });

        res.json({
            success: true,
            title: req.body.title,
            category: channelResponse.data.data[0]?.game_name || ''
        });
    } catch (error) {
        handleApiError(res, error);
    }
});

// Mod Stats
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
    const errorData = error.response?.data || {};

    // Extract the most specific error message possible
    let errorMessage = 'Request failed';

    // Check for Twitch API error format
    if (errorData.error && typeof errorData.error === 'string') {
        errorMessage = errorData.error;
        if (errorData.message && typeof errorData.message === 'string') {
            errorMessage += `: ${errorData.message}`;
        }
    }
    // Check for common error formats
    else if (errorData.message) {
        errorMessage = errorData.message;
    } else if (error.message) {
        errorMessage = error.message;
    }

    res.status(statusCode).json({
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? {
            originalError: error.message,
            fullResponse: error.response?.data
        } : undefined
    });
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Twitch Client ID:', process.env.TWITCH_CLIENT_ID);
});