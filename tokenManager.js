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
            const token = await Token.findOne({ channelName: this.channelName }).select('+accessToken +refreshToken');
            if (!token) return null;

            // Decrypt tokens before returning
            return {
                ...token.toObject(),
                accessToken: decrypt(token.accessToken.substring(4)), // Remove 'enc:' prefix
                refreshToken: decrypt(token.refreshToken.substring(4))
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

            // Prepare channel data
            const channelInfo = {
                id: channelData.id,
                login: channelData.login,
                display_name: channelData.display_name,
                profile_image_url: channelData.profile_image_url,
                broadcaster_type: channelData.broadcaster_type,
                connectedAt: new Date(),
                status: 'connected'
            };

            const tokenData = {
                channelName: this.channelName,
                accessToken: 'enc:' + await encrypt(tokens.access_token),
                refreshToken: 'enc:' + await encrypt(tokens.refresh_token),
                expiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                scope: tokens.scope || [],
                tokenType: tokens.token_type || 'bearer',
                channelData: channelInfo
            };

            const options = {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            };

            const result = await Token.findOneAndUpdate(
                { channelName: this.channelName },
                tokenData,
                options
            );

            console.log('Tokens saved for channel:', this.channelName);
            return { success: true };
        } catch (error) {
            console.error('Failed to save tokens:', error);
            return { success: false, error: error.message };
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
                timeout: 5000
            });

            const saveResult = await this.saveTokens(response.data, token.channelData);
            return saveResult.success;
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
}

module.exports = TokenManager;