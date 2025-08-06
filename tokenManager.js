const axios = require('axios');
const Token = require('./models/Token');
const { encrypt, decrypt } = require('./utils/crypto');
class TokenManager {
    constructor(channelName) {
        this.channelName = channelName;
    }

    async getTokens() {
        try {
            return await Token.findOne({ channelName: this.channelName });
        } catch (error) {
            console.error(`Error fetching tokens for ${this.channelName}:`, error);
            return null;
        }
    }

    async saveTokens(tokens, channelData) {
        try {
            const { encrypt } = require('./utils/crypto'); // Move require inside to catch errors

            const tokenData = {
                channelName: this.channelName,
                accessToken: encrypt(tokens.access_token),
                refreshToken: encrypt(tokens.refresh_token),
                expiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                scope: tokens.scope,
                tokenType: tokens.token_type,
                channelData: {
                    ...channelData,
                    connectedAt: new Date()
                }
            };

            await Token.findOneAndUpdate(
                { channelName: this.channelName },
                tokenData,
                { upsert: true, new: true }
            );
            return true;
        } catch (error) {
            console.error(`Failed to save tokens for ${this.channelName}:`, error.message);
            return false;
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
                }
            });

            await this.saveTokens(response.data, token.channelData);
            return true;
        } catch (error) {
            console.error(`Token refresh failed for ${this.channelName}:`, error.response?.data || error.message);
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

            return decrypt(token.accessToken);
        } catch (error) {
            console.error(`Error getting access token for ${this.channelName}:`, error);
            return null;
        }
    }

    async getChannelData() {
        try {
            const token = await this.getTokens();
            return token?.channelData;
        } catch (error) {
            console.error(`Error getting channel data for ${this.channelName}:`, error);
            return null;
        }
    }

    async disconnectChannel() {
        try {
            await Token.deleteOne({ channelName: this.channelName });
            return true;
        } catch (error) {
            console.error(`Error disconnecting channel ${this.channelName}:`, error);
            return false;
        }
    }
}

module.exports = TokenManager;