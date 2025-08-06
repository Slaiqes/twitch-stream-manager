const axios = require('axios');
const Token = require('./models/Token');
const { encrypt, decrypt } = require('./utils/crypto');
const jwt = require('jsonwebtoken');

class TokenManager {
    constructor(channelName) {
        this.channelName = channelName;
    }

    async getTokens() {
        try {
            const token = await Token.findOne({ channelName: this.channelName });
            if (!token) return null;

            // Decrypt tokens before returning
            return {
                ...token.toObject(),
                accessToken: decrypt(token.accessToken),
                refreshToken: decrypt(token.refreshToken)
            };
        } catch (error) {
            console.error(`Error fetching tokens for ${this.channelName}:`, error);
            return null;
        }
    }

    async saveTokens(tokens, channelData) {
        try {
            // Validate required fields
            if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
                throw new Error('Invalid tokens provided');
            }

            const tokenData = {
                channelName: this.channelName,
                accessToken: encrypt(tokens.access_token),
                refreshToken: encrypt(tokens.refresh_token),
                expiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                scope: tokens.scope || [],
                tokenType: tokens.token_type || 'bearer',
                channelData: {
                    ...channelData,
                    connectedAt: new Date(),
                    status: 'connected'
                }
            };

            const options = {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            };

            const savedToken = await Token.findOneAndUpdate(
                { channelName: this.channelName },
                tokenData,
                options
            );

            // Generate a JWT for the streamer if this is not an admin action
            if (!this.isAdminAction()) {
                const userToken = jwt.sign(
                    {
                        role: 'streamer',
                        channel: this.channelName
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: '8h' }
                );
                return { saved: true, userToken };
            }

            return { saved: true };
        } catch (error) {
            console.error(`Failed to save tokens for ${this.channelName}:`, error.message);
            return { saved: false, error: error.message };
        }
    }

    async refreshTokens() {
        try {
            const token = await this.getTokens();
            if (!token?.refreshToken) {
                console.log(`No refresh token available for ${this.channelName}`);
                return false;
            }

            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: token.refreshToken
                },
                timeout: 5000 // Add timeout for security
            });

            const saveResult = await this.saveTokens(response.data, token.channelData);
            return saveResult.saved;
        } catch (error) {
            console.error(`Token refresh failed for ${this.channelName}:`, {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });

            // Mark token as expired if refresh failed
            await Token.updateOne(
                { channelName: this.channelName },
                { 'channelData.status': 'expired' }
            );

            return false;
        }
    }

    async getAccessToken() {
        try {
            const token = await this.getTokens();
            if (!token) return null;

            // Refresh if token expires in less than 5 minutes
            if (new Date() > new Date(token.expiresAt.getTime() - 5 * 60 * 1000)) {
                const refreshed = await this.refreshTokens();
                if (!refreshed) return null;
                return (await this.getTokens())?.accessToken;
            }

            return token.accessToken;
        } catch (error) {
            console.error(`Error getting access token for ${this.channelName}:`, error);
            return null;
        }
    }

    async getChannelData() {
        try {
            const token = await Token.findOne({ channelName: this.channelName });
            if (!token) return null;

            return {
                ...token.channelData,
                login: this.channelName,
                status: token.channelData.status || 'connected',
                refreshAt: new Date(token.expiresAt.getTime() - 5 * 60 * 1000)
            };
        } catch (error) {
            console.error(`Error getting channel data for ${this.channelName}:`, error);
            return null;
        }
    }

    async disconnectChannel() {
        try {
            const result = await Token.deleteOne({ channelName: this.channelName });
            return result.deletedCount > 0;
        } catch (error) {
            console.error(`Error disconnecting channel ${this.channelName}:`, error);
            return false;
        }
    }

    async updateChannelData(update) {
        try {
            await Token.updateOne(
                { channelName: this.channelName },
                { $set: { channelData: update } }
            );
            return true;
        } catch (error) {
            console.error(`Error updating channel data for ${this.channelName}:`, error);
            return false;
        }
    }

    isAdminAction() {
        // Implement logic to check if this is an admin-initiated action
        // This could check the call stack or use a context parameter
        return false; // Default to false for safety
    }
}

module.exports = TokenManager;