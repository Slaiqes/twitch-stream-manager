document.addEventListener('DOMContentLoaded', () => {
    // Check for token in cookies first, then fall back to localStorage
    const token = document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1] ||
        localStorage.getItem('authToken');

    const path = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);

    // Handle token from URL (OAuth redirect) - this remains unchanged
    if (urlParams.has('token')) {
        const urlToken = urlParams.get('token');
        try {
            const decoded = jwt_decode(urlToken);

            // Store in both cookie and localStorage for compatibility
            document.cookie = `token=${urlToken}; path=/; max-age=${8 * 60 * 60}; ${location.protocol === 'https:' ? 'secure' : ''}`;
            localStorage.setItem('authToken', urlToken);
            localStorage.setItem('userRole', decoded.role);

            if (decoded.channel) {
                localStorage.setItem('channelName', decoded.channel);
            }

            // Remove token from URL
            window.history.replaceState({}, document.title, window.location.pathname);

            // Redirect based on role
            if (decoded.role === 'admin') {
                window.location.href = '/hub.html';
            } else if (decoded.role === 'streamer' && decoded.channel) {
                window.location.href = `/c/${decoded.channel}`;
            }
            return;
        } catch (err) {
            console.error('Invalid token in URL:', err);
            document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('channelName');
        }
    }

    // If no token and not on login page, redirect to login
    if (!token && !path.includes('login')) {
        window.location.href = '/login';
        return;
    }

    // If token exists and on login page, redirect based on role
    if (token && path.includes('login')) {
        try {
            const decoded = jwt_decode(token);

            // Ensure cookie is set if we only had localStorage token
            if (!document.cookie.includes('token=')) {
                document.cookie = `token=${token}; path=/; max-age=${8 * 60 * 60}; ${location.protocol === 'https:' ? 'secure' : ''}`;
            }

            if (decoded.role === 'admin') {
                window.location.href = '/hub.html';
            } else if (decoded.role === 'streamer' && decoded.channel) {
                window.location.href = `/c/${decoded.channel}`;
            }
            return;
        } catch (err) {
            console.error('Invalid token:', err);
            document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('channelName');
        }
    }

    // Initialize hub if on hub page
    if (path.includes('hub')) {
        initializeHub();
    }

    // Show success message if redirected after connection
    if (urlParams.get('connect_success') === 'true') {
        alert('Channel connected successfully!');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});

// Admin login functionality
document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
        })
    });

    if (response.ok) {
        const data = await response.json();
        // Store token in localStorage for API calls
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userRole', data.role);

        // Redirect to hub - the cookie is already set by the server
        window.location.href = '/hub.html';
    } else {
        alert('Admin login failed!');
    }
});

// Tab switching on login page
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabType = tab.getAttribute('data-tab');

        // Update active tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding form
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        document.querySelector(`.auth-form[data-form="${tabType}"]`).classList.add('active');
    });
});

// Initialize hub page
function initializeHub() {
    const token = localStorage.getItem('authToken');
    const role = localStorage.getItem('userRole');

    // Verify admin role
    if (role !== 'admin') {
        window.location.href = '/login';
        return;
    }

    // Load channels
    loadChannels();

    // Set up connect channel button
    document.getElementById('connectChannel')?.addEventListener('click', () => {
        window.location.href = '/auth/twitch';
    });

    // Set up logout button
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userRole');
        window.location.href = '/login';
    });

    // Set up search functionality
    const searchInput = document.querySelector('.search-box input');
    searchInput?.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        document.querySelectorAll('.channel-card').forEach(card => {
            const channelName = card.querySelector('h3').textContent.toLowerCase();
            card.style.display = channelName.includes(searchTerm) ? 'block' : 'none';
        });
    });

    // Auto-refresh every minute
    setInterval(loadChannels, 60000);
}

// Load channels in hub
async function loadChannels() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch('/api/channels', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!response.ok) throw new Error('Failed to load channels');

        const channels = await response.json();
        const channelList = document.getElementById('channelList');
        if (!channelList) return;

        // Update channel count
        document.getElementById('channelCount').textContent = channels.length;

        channelList.innerHTML = '';

        if (channels.length === 0) {
            channelList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-stream"></i>
                    <h3>No channels connected</h3>
                    <p>Connect your first Twitch channel to get started</p>
                    <button id="connectChannel" class="btn btn-primary">
                        <i class="fas fa-plus"></i> Connect Channel
                    </button>
                </div>
            `;
            return;
        }

        channels.forEach(channel => {
            const channelCard = document.createElement('div');
            channelCard.className = 'channel-card';
            channelCard.innerHTML = `
                <div class="card-header">
                    <img src="${channel.profile_image_url}" alt="${channel.display_name}" class="channel-avatar">
                    <span class="channel-status status-${channel.status}">${channel.status}</span>
                </div>
                <div class="card-body">
                    <h3>${channel.display_name}</h3>
                    <p class="channel-meta">
                        <span>${channel.broadcaster_type || 'Streamer'}</span>
                        <span>Connected ${new Date(channel.connectedAt).toLocaleDateString()}</span>
                    </p>
                    <a href="/c/${channel.login}" class="btn btn-primary btn-block">
                        <i class="fas fa-cog"></i> Manage Channel
                    </a>
                </div>
            `;
            channelList.appendChild(channelCard);
        });
    } catch (error) {
        console.error('Failed to load channels:', error);
        const channelList = document.getElementById('channelList');
        if (channelList) {
            channelList.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Failed to load channels</h3>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="loadChannels()">
                        <i class="fas fa-sync-alt"></i> Retry
                    </button>
                </div>
            `;
        }
    }
}