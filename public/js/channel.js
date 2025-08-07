let currentChannel = null;
let channelData = null;
let modStatsChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    // First check for token in URL (fallback for cookie issues)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken) {
        try {
            const decoded = jwt_decode(urlToken);

            // Store in both cookie and localStorage
            document.cookie = `token=${urlToken}; path=/; max-age=${8 * 60 * 60}; ${location.protocol === 'https:' ? 'secure; sameSite=lax' : ''}`;
            localStorage.setItem('authToken', urlToken);
            localStorage.setItem('userRole', decoded.role);
            localStorage.setItem('channelName', decoded.channel);

            // Remove token from URL
            window.history.replaceState({}, document.title, window.location.pathname);

            // Continue with initialization
            await initializeChannel();
            return;
        } catch (err) {
            console.error('Invalid URL token:', err);
            clearAuth();
        }
    }

    // Fall back to normal token check
    await checkAuthAndInitialize();
});

async function checkAuthAndInitialize() {
    // Check authentication from localStorage or cookie
    const token = localStorage.getItem('authToken') ||
        document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];

    if (!token) {
        clearAuth();
        return;
    }

    // Get channel from URL
    const pathParts = window.location.pathname.split('/').filter(part => part);
    if (pathParts[0] === 'c' && pathParts[1]) {
        currentChannel = pathParts[1].replace('.html', '');
    } else {
        clearAuth();
        return;
    }

    try {
        const decoded = jwt_decode(token);

        // Verify permissions
        if (decoded.role !== 'admin' && decoded.channel !== currentChannel) {
            throw new Error('Channel access denied');
        }

        // Store user info
        localStorage.setItem('userRole', decoded.role);
        if (decoded.channel) {
            localStorage.setItem('channelName', decoded.channel);
        }

        // Hide back to hub button for non-admins
        if (decoded.role !== 'admin') {
            document.getElementById('backToHubBtn').style.display = 'none';
        }

        // Initialize channel
        await initializeChannel();
    } catch (err) {
        console.error('Authentication error:', err);
        clearAuth();
    }
}

async function initializeChannel() {
    // Update the back to hub button handler
    document.getElementById('backToHubBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/hub.html';
    });

    // Initialize channel components
    await loadChannelData();
    setupNavigation();
    setupActionHandlers();
    loadModStats();

    // Update breadcrumb
    document.getElementById('breadcrumbChannel').textContent = currentChannel;
}

function clearAuth() {
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('channelName');
    window.location.href = '/login';
}

async function loadChannelData() {
    console.log('Loading channel data for:', currentChannel);
    console.log('Current token:', localStorage.getItem('authToken'));

    try {
        const token = localStorage.getItem('authToken');
        if (!token) throw new Error('No token found');

        // Load channel info
        const response = await fetch(`/api/channels`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            // Token is invalid, clear storage and redirect
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            localStorage.removeItem('channelName');
            window.location.href = '/login';
            return;
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const channels = await response.json();
        channelData = channels.find(c => c.login === currentChannel);

        if (!channelData) {
            // If admin, redirect to hub
            const role = localStorage.getItem('userRole');
            if (role === 'admin') {
                window.location.href = '/hub.html';
                return;
            }
            throw new Error('Channel not found');
        }

        // Update UI
        document.getElementById('channelName').textContent = channelData.display_name;
        document.getElementById('channelAvatar').src = channelData.profile_image_url;
        document.getElementById('headerAvatar').src = channelData.profile_image_url;

        // Update status
        updateConnectionStatus();

        // Load stream info
        await loadStreamInfo();

    } catch (error) {
        console.error('Failed to load channel data:', error);

        // Clear storage and redirect to login
        localStorage.removeItem('authToken');
        localStorage.removeItem('userRole');
        localStorage.removeItem('channelName');

        window.location.href = '/login';
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('channelStatus');
    const tokenStatusElement = document.getElementById('tokenStatus');

    if (channelData.status === 'connected') {
        statusElement.innerHTML = '<i class="fas fa-circle status-icon"></i> Connected';
        statusElement.className = 'badge badge-lg badge-success';
    } else {
        statusElement.innerHTML = '<i class="fas fa-circle status-icon"></i> Disconnected';
        statusElement.className = 'badge badge-lg badge-danger';
    }

    // Token expiration info
    const expiresAt = new Date(channelData.expiresAt);
    const refreshAt = new Date(channelData.refreshAt);
    const now = new Date();

    if (now > expiresAt) {
        tokenStatusElement.innerHTML = '<i class="fas fa-key"></i> Token expired';
        tokenStatusElement.className = 'badge badge-secondary badge-danger';
    } else if (now > refreshAt) {
        const minsLeft = Math.round((expiresAt - now) / 1000 / 60);
        tokenStatusElement.innerHTML = `<i class="fas fa-key"></i> Expires in ${minsLeft} min`;
        tokenStatusElement.className = 'badge badge-secondary badge-warning';
    } else {
        const minsLeft = Math.round((expiresAt - now) / 1000 / 60);
        tokenStatusElement.innerHTML = `<i class="fas fa-key"></i> Valid (${minsLeft} min)`;
        tokenStatusElement.className = 'badge badge-secondary badge-success';
    }
}

async function loadStreamInfo() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/${currentChannel}/stream-info`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to load stream info');

        const data = await response.json();

        const statusElement = document.getElementById('streamStatus');
        const titleElement = document.getElementById('streamTitle');
        const categoryElement = document.getElementById('streamCategory');
        const startedElement = document.getElementById('streamStarted');

        if (data.isLive) {
            statusElement.innerHTML = '<i class="fas fa-circle status-icon status-pulse"></i> Live';
            statusElement.className = 'info-value status-online';
            startedElement.textContent = new Date(data.startedAt).toLocaleString();
        } else {
            statusElement.innerHTML = '<i class="fas fa-circle status-icon"></i> Offline';
            statusElement.className = 'info-value status-offline';
            startedElement.textContent = '-';
        }

        titleElement.textContent = data.title || 'No title set';
        categoryElement.textContent = data.category || 'No category set';

        // Set values in form
        document.getElementById('streamTitleInput').value = data.title || '';
        document.getElementById('streamCategoryInput').value = data.category || '';

    } catch (error) {
        console.error('Failed to load stream info:', error);
        document.getElementById('streamStatus').textContent = 'Error loading stream info';
    }
}

function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('.section-content');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active nav item
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show section
            const sectionId = link.getAttribute('data-section');
            showSection(sectionId);

            // Update page title
            document.getElementById('pageTitle').textContent = link.querySelector('span').textContent;
        });
    });
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.remove('active');
    });

    // Show requested section
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');

        // Special handling for certain sections
        if (sectionId === 'mod-stats') {
            loadModStats();
        }
    }
}

function setupActionHandlers() {
    // Ban User
    document.getElementById('banUser').addEventListener('click', handleBanUser);

    // Timeout User
    document.getElementById('timeoutUser').addEventListener('click', handleTimeoutUser);

    // Mod Management
    document.getElementById('modUser').addEventListener('click', () => handleModAction('mod'));
    document.getElementById('unmodUser').addEventListener('click', () => handleModAction('unmod'));

    // VIP Management
    document.getElementById('addVip').addEventListener('click', () => handleModAction('vip'));
    document.getElementById('removeVip').addEventListener('click', () => handleModAction('unvip'));

    // Commercials
    document.getElementById('runCommercial').addEventListener('click', handleCommercial);

    // Stream Info Update
    document.getElementById('updateStreamInfo').addEventListener('click', handleStreamInfoUpdate);

    // Category Search
    document.getElementById('streamCategoryInput').addEventListener('input', handleCategorySearch);

    // Back to Hub
    document.getElementById('backToHubBtn').addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/hub.html';
    });

    // Logout
    document.getElementById('channelLogout')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('authToken');
        localStorage.removeItem('userRole');
        localStorage.removeItem('channelName');
        window.location.href = '/login';
    });
}

async function handleBanUser() {
    const username = document.getElementById('banUsername').value.trim();
    const reason = document.getElementById('banReason').value.trim();
    const resultElement = document.getElementById('banResult');

    if (!username) {
        showResult(resultElement, 'Please enter a username', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');

        // Get user ID
        const userIdResponse = await fetch(`/api/${currentChannel}/user-id?username=${encodeURIComponent(username)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!userIdResponse.ok) {
            throw new Error('User not found');
        }

        const { userId } = await userIdResponse.json();

        // Ban user
        const banResponse = await fetch(`/api/${currentChannel}/ban`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId,
                reason: reason || 'Banned via Stream Manager'
            })
        });

        if (!banResponse.ok) {
            const errorData = await banResponse.json();
            throw new Error(errorData.error || 'Ban failed');
        }

        showResult(resultElement, `${username} has been banned`, 'success');
        document.getElementById('banUsername').value = '';
        document.getElementById('banReason').value = '';

        // Refresh mod stats
        loadModStats();
    } catch (error) {
        console.error('Ban error:', error);
        showResult(resultElement, `Ban failed: ${error.message}`, 'error');
    }
}

async function handleTimeoutUser() {
    const username = document.getElementById('timeoutUsername').value.trim();
    const duration = document.getElementById('timeoutDuration').value;
    const reason = document.getElementById('timeoutReason').value.trim();
    const resultElement = document.getElementById('timeoutResult');

    if (!username) {
        showResult(resultElement, 'Please enter a username', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');

        // Get user ID
        const userIdResponse = await fetch(`/api/${currentChannel}/user-id?username=${encodeURIComponent(username)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!userIdResponse.ok) {
            throw new Error('User not found');
        }

        const { userId } = await userIdResponse.json();

        // Timeout user
        const timeoutResponse = await fetch(`/api/${currentChannel}/timeout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId,
                duration,
                reason: reason || 'Timed out via Stream Manager'
            })
        });

        if (!timeoutResponse.ok) {
            const errorData = await timeoutResponse.json();
            throw new Error(errorData.error || 'Timeout failed');
        }

        const durationText = duration >= 86400 ?
            `${Math.round(duration / 86400)} days` :
            `${Math.round(duration / 60)} minutes`;

        showResult(resultElement, `${username} timed out for ${durationText}`, 'success');
        document.getElementById('timeoutUsername').value = '';
        document.getElementById('timeoutReason').value = '';

        // Refresh mod stats
        loadModStats();
    } catch (error) {
        console.error('Timeout error:', error);
        showResult(resultElement, `Timeout failed: ${error.message}`, 'error');
    }
}

async function handleModAction(action) {
    const usernameElement = document.getElementById(`${action === 'vip' || action === 'unvip' ? 'vip' : 'mod'}Username`);
    const username = usernameElement.value.trim();
    const resultElement = document.getElementById(`${action === 'vip' || action === 'unvip' ? 'vip' : 'mod'}Result`);

    if (!username) {
        showResult(resultElement, 'Please enter a username', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');

        // Get user ID
        const userIdResponse = await fetch(`/api/${currentChannel}/user-id?username=${encodeURIComponent(username)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!userIdResponse.ok) {
            throw new Error('User not found');
        }

        const { userId } = await userIdResponse.json();

        // Perform action
        const actionResponse = await fetch(`/api/${currentChannel}/${action}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });

        if (!actionResponse.ok) {
            const errorData = await actionResponse.json();
            throw new Error(errorData.error || 'Action failed');
        }

        const actionText = {
            'mod': 'moderator',
            'unmod': 'removed as moderator',
            'vip': 'VIP',
            'unvip': 'removed as VIP'
        }[action];

        showResult(resultElement, `${username} has been ${actionText}`, 'success');
        usernameElement.value = '';

        // Refresh mod stats if relevant
        if (action === 'mod' || action === 'unmod') {
            loadModStats();
        }
    } catch (error) {
        console.error(`${action} error:`, error);
        showResult(resultElement, `${actionText || 'Action'} failed: ${error.message}`, 'error');
    }
}

async function handleCommercial() {
    const length = document.getElementById('commercialLength').value;
    const resultElement = document.getElementById('commercialResult');

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/${currentChannel}/commercial`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ length })
        });

        const result = await response.json();

        if (response.ok) {
            showResult(resultElement, `Commercial started for ${length} seconds`, 'success');

            // Add to commercial history UI
            addCommercialToHistory(length);
        } else {
            showResult(resultElement, `Commercial failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Commercial error:', error);
        showResult(resultElement, 'Commercial failed - check console', 'error');
    }
}

function addCommercialToHistory(length) {
    const historyContainer = document.querySelector('.commercial-history');
    const now = new Date();

    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';

    const timeElement = document.createElement('div');
    timeElement.className = 'history-time';
    timeElement.textContent = 'Just now';

    const durationElement = document.createElement('div');
    durationElement.className = 'history-duration';
    durationElement.textContent = `${length} seconds`;

    historyItem.appendChild(timeElement);
    historyItem.appendChild(durationElement);

    // Insert at the top
    if (historyContainer.firstChild) {
        historyContainer.insertBefore(historyItem, historyContainer.firstChild);
    } else {
        historyContainer.appendChild(historyItem);
    }

    // Update timers periodically
    const updateTime = () => {
        const seconds = Math.floor((new Date() - now) / 1000);
        let displayText;

        if (seconds < 60) {
            displayText = `${seconds} seconds ago`;
        } else if (seconds < 3600) {
            displayText = `${Math.floor(seconds / 60)} minutes ago`;
        } else {
            displayText = `${Math.floor(seconds / 3600)} hours ago`;
        }

        timeElement.textContent = displayText;
    };

    updateTime();
    const timer = setInterval(updateTime, 60000);

    // Clean up timer when element is removed
    historyItem.addEventListener('DOMNodeRemoved', () => {
        clearInterval(timer);
    });
}

async function handleStreamInfoUpdate() {
    const title = document.getElementById('streamTitleInput').value.trim();
    const category = document.getElementById('streamCategoryInput').value.trim();
    const resultElement = document.getElementById('streamUpdateResult');

    if (!title) {
        showResult(resultElement, 'Please enter a title', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/${currentChannel}/stream-info`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title,
                gameId: '' // You'd need to implement game ID lookup
            })
        });

        const result = await response.json();

        if (response.ok) {
            showResult(resultElement, 'Stream info updated successfully', 'success');
            await loadStreamInfo(); // Refresh displayed info
        } else {
            showResult(resultElement, `Update failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Update error:', error);
        showResult(resultElement, 'Update failed - check console', 'error');
    }
}

async function handleCategorySearch() {
    const query = document.getElementById('streamCategoryInput').value.trim();
    const resultsContainer = document.getElementById('categoryResults');

    if (query.length < 3) {
        resultsContainer.classList.remove('show');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent(query)}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID
            }
        });

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        resultsContainer.innerHTML = '';

        if (data.data && data.data.length > 0) {
            data.data.forEach(category => {
                const div = document.createElement('div');
                div.textContent = category.name;
                div.addEventListener('click', () => {
                    document.getElementById('streamCategoryInput').value = category.name;
                    resultsContainer.classList.remove('show');
                });
                resultsContainer.appendChild(div);
            });
            resultsContainer.classList.add('show');
        } else {
            resultsContainer.classList.remove('show');
        }
    } catch (error) {
        console.error('Category search error:', error);
        resultsContainer.classList.remove('show');
    }
}

async function loadModStats() {
    try {
        const timeframe = document.getElementById('statsTimeframe').value;
        const token = localStorage.getItem('authToken');

        const response = await fetch(`/api/${currentChannel}/mod-stats?days=${timeframe}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Failed to load mod stats');

        const stats = await response.json();
        const tbody = document.getElementById('modStatsBody');
        tbody.innerHTML = '';

        if (stats.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="5" class="text-center">No moderation data available</td>`;
            tbody.appendChild(row);
            return;
        }

        stats.forEach((mod, index) => {
            const row = document.createElement('tr');
            const actionsPerDay = timeframe > 0 ? (mod.totalActions / timeframe).toFixed(2) : '-';

            row.innerHTML = `
                <td>${mod.moderatorName}</td>
                <td>${mod.totalActions}</td>
                <td>${mod.timeouts}</td>
                <td>${mod.bans}</td>
                <td>${actionsPerDay}</td>
            `;

            if (index === 0) {
                row.classList.add('top-mod');
            }

            tbody.appendChild(row);
        });

        updateModStatsChart(stats);
    } catch (error) {
        console.error('Failed to load mod stats:', error);
        const tbody = document.getElementById('modStatsBody');
        tbody.innerHTML = `<tr><td colspan="5">Error loading stats: ${error.message}</td></tr>`;
    }
}

function updateModStatsChart(stats) {
    const ctx = document.getElementById('modStatsChart').getContext('2d');
    const topMods = stats.slice(0, 5);

    if (modStatsChart) {
        modStatsChart.destroy();
    }

    modStatsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topMods.map(mod => mod.moderatorName),
            datasets: [
                {
                    label: 'Timeouts',
                    data: topMods.map(mod => mod.timeouts),
                    backgroundColor: 'rgba(255, 159, 64, 0.7)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Bans',
                    data: topMods.map(mod => mod.bans),
                    backgroundColor: 'rgba(255, 99, 132, 0.7)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Top Moderators',
                    color: 'var(--text-primary)'
                },
                legend: {
                    labels: {
                        color: 'var(--text-primary)'
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: 'var(--text-primary)'
                    },
                    grid: {
                        color: 'var(--border-color)'
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: 'var(--text-primary)'
                    },
                    grid: {
                        color: 'var(--border-color)'
                    }
                }
            }
        }
    });
}

function showResult(elementId, message, type) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = message;
    element.className = `result-message ${type}`;

    // Clear after 5 seconds
    setTimeout(() => {
        element.textContent = '';
        element.className = 'result-message';
    }, 5000);
}

// Auto-refresh token status every minute
setInterval(updateConnectionStatus, 60000);

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-combo')) {
        document.getElementById('categoryResults').classList.remove('show');
    }
});