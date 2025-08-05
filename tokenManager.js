const fs = require('fs');
const path = require('path');
const axios = require('axios');

class TokenManager {
    constructor(channelName) {
        this.channelName = channelName;
        this.tokenDir = path.join(__dirname, 'channel_tokens');
        this.tokenPath = path.join(this.tokenDir, `${channelName}.json`);
        this.ensureTokenDir();
    }

    ensureTokenDir() {
        if (!fs.existsSync(this.tokenDir)) {
            fs.mkdirSync(this.tokenDir);
        }
    }

    async getTokens() {
        if (fs.existsSync(this.tokenPath)) {
            return JSON.parse(fs.readFileSync(this.tokenPath));
        }
        return null;
    }

    async saveTokens(tokens) {
        const data = {
            ...tokens,
            expiresAt: Date.now() + (tokens.expires_in * 1000)
        };
        fs.writeFileSync(this.tokenPath, JSON.stringify(data, null, 2));
    }

    async refreshTokens() {
        const tokens = await this.getTokens();
        if (!tokens?.refresh_token) return false;

        try {
            const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                params: {
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refresh_token
                }
            });

            await this.saveTokens(response.data);
            return true;
        } catch (error) {
            console.error(`Token refresh failed for ${this.channelName}:`, error.message);
            return false;
        }
    }

    async getAccessToken() {
        const tokens = await this.getTokens();
        if (!tokens) return null;

        // Refresh if token expires in less than 5 minutes
        if (tokens.expiresAt - Date.now() < 300000) {
            const refreshed = await this.refreshTokens();
            if (!refreshed) return null;
        }

        const updatedTokens = await this.getTokens();
        return updatedTokens?.access_token;
    }
}

module.exports = TokenManager;