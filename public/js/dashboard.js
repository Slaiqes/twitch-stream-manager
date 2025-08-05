// Login functionality
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
        })
    });

    if (response.ok) {
        window.location.href = '/hub.html';
    } else {
        alert('Login failed!');
    }
});

// Load channels in hub
async function loadChannels() {
    const response = await fetch('/api/channels');
    const channels = await response.json();

    const channelList = document.getElementById('channelList');
    if (!channelList) return;

    channelList.innerHTML = '';

    channels.forEach(channel => {
        const channelCard = document.createElement('div');
        channelCard.className = 'channel-card';
        channelCard.innerHTML = `
            <img src="${channel.profile_image_url}" alt="${channel.display_name}" class="channel-avatar">
            <div class="channel-info">
                <h3>${channel.display_name}</h3>
                <p>${channel.broadcaster_type || 'Streamer'}</p>
                <span class="channel-status status-${channel.status}">${channel.status}</span>
                <a href="/channel.html?channel=${channel.login}" class="btn btn-primary" style="margin-top: 1rem;">Manage Channel</a>
            </div>
        `;
        channelList.appendChild(channelCard);
    });
}

// Connect new channel
document.getElementById('connectChannel')?.addEventListener('click', () => {
    window.location.href = '/auth/twitch';
});

// Initialize hub
if (window.location.pathname.includes('hub.html')) {
    loadChannels();
    setInterval(loadChannels, 60000); // Refresh every minute
}