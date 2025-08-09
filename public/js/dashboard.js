document.addEventListener('DOMContentLoaded', () => {
    // Debug initial state
    console.log('Initial load - auth state:', {
        cookieToken: document.cookie.includes('token='),
        localStorageToken: !!localStorage.getItem('authToken'),
        path: window.location.pathname
    });

    // Handle hub page initialization
    if (window.location.pathname.includes('/hub')) {
        // First try localStorage, then cookie
        const token = localStorage.getItem('authToken') ||
            document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];

        if (!token) {
            console.log('No token found, redirecting to login');
            window.location.href = '/login';
            return;
        }

        initializeHub();
    }

    // Initialize login page tabs if needed
    initializeLoginTabs();
});
function initializeLoginTabs() {
    // Your existing tab initialization code
    const defaultTab = document.querySelector('.tab[data-tab="streamer"]');
    if (!document.querySelector('.tab.active')) {
        defaultTab?.classList.add('active');
    }

    const defaultForm = document.querySelector('.auth-form[data-form="streamer"]');
    if (defaultForm && !document.querySelector('.auth-form.active')) {
        defaultForm.classList.add('active');
    }

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabType = tab.getAttribute('data-tab');
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.auth-form').forEach(form => {
                form.classList.remove('active');
                if (form.getAttribute('data-form') === tabType) {
                    form.classList.add('active');
                }
            });
        });
    });
}
document.getElementById('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        console.log('Sending login request...');
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username, password }),
            credentials: 'include' // Important for cookies
        });

        console.log('Received response, status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);

        if (response.ok) {
            console.log('Login successful, storing token...');
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userRole', data.role);

            // Add delay to ensure storage is complete
            setTimeout(() => {
                console.log('Redirecting to hub.html...');
                window.location.href = '/hub.html';
            }, 100);
        } else {
            console.error('Login failed:', data.error);
            alert(`Login failed: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please check console for details.');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Set the initial active tab to Streamer if not already set
    const defaultTab = document.querySelector('.tab[data-tab="streamer"]');
    if (!document.querySelector('.tab.active')) {
        defaultTab.classList.add('active'); // Corrected the add active class to just 'active'
    }

    // Set the initial active form to Streamer if not already set
    const defaultForm = document.querySelector('.auth-form[data-form="streamer"]');
    if (defaultForm && !document.querySelector('.auth-form.active')) {
        defaultForm.classList.add('active'); // Show Streamer form by default
    }

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
});




// Initialize hub page
function initializeHub() {
    console.log('Initializing hub - checking auth state');
    const token = localStorage.getItem('authToken');

    if (!token) {
        console.warn('No token in localStorage, checking cookies');
        const cookieToken = document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
        if (cookieToken) {
            console.log('Found token in cookie, storing in localStorage');
            localStorage.setItem('authToken', cookieToken);
        } else {
            console.warn('No auth token found, redirecting to login');
            window.location.href = '/login';
            return;
        }
    }
    console.log('User is authenticated, proceeding...');
    console.log('Initializing hub page...');
    const role = localStorage.getItem('userRole');
    console.log('Current auth state:', { token, role });

    // Second check - verify admin role
    if (role !== 'admin') {
        console.warn('User is not admin, redirecting to login');
        window.location.href = '/login';
        return;
    }

    console.log('User is authenticated, loading channels...');
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

        // In your loadChannels() function
        channels.forEach(channel => {
            const channelCard = document.createElement('div');
            channelCard.className = 'channel-card';
            channelCard.innerHTML = `
        <div class="channel-card-content">
            <div class="channel-avatar-container">
                <img src="${channel.profile_image_url}" alt="${channel.display_name}" class="channel-avatar">
                ${channel.isLive ? '<span class="live-badge">LIVE</span>' : ''}
            </div>
            <div class="channel-info">
                <div class="channel-header">
                    <h3>${channel.display_name}</h3>
                    <span class="broadcaster-status ${channel.broadcaster_type || 'streamer'}">
                        ${channel.broadcaster_type || 'Streamer'}
                    </span>
                </div>
                
                <div class="status-divider"></div>
                
                <div class="channel-stats">
                    <span class="follower-count">
                        <i class="fas fa-users"></i> ${channel.followers.toLocaleString()}
                    </span>
                    <span class="stream-status ${channel.isLive ? 'live' : 'offline'}">
                        <i class="fas fa-circle"></i> ${channel.isLive ? 'Live Now' : 'Channel Offline'}
                    </span>
                </div>
                
                <a href="/c/${channel.login}" class="btn btn-manage" 
           
            <i class="fas fa-cog"></i> Manage
        </a>
            </div>
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
// Add this function to dashboard.js
window.verifyChannelAccess = async (channelName) => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    try {
        const decoded = jwt.decode(token);
        if (decoded.role === 'admin' || decoded.channel === channelName) {
            window.location.href = `/c/${channelName}`;
        } else {
            alert('You can only manage your own channel');
        }
    } catch (error) {
        console.error('Token verification failed:', error);
        window.location.href = '/login';
    }
};
