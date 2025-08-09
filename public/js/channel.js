let currentChannel = null;
let channelData = null;
let modStatsChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Get channel from URL
    const pathParts = window.location.pathname.split('/').filter(part => part);
    if (pathParts[0] === 'c' && pathParts[1]) {
        const channelName = pathParts[1].replace('.html', '');

        try {
            // Verify we have a token
            const response = await fetch('/api/verify-auth', {
                credentials: 'include'
            });

            if (!response.ok) {
                window.location.href = '/login';
                return;
            }

            const data = await response.json();
            if (data.user.role !== 'admin' && data.user.channel !== channelName) {
                window.location.href = '/login';
                return;
            }

            currentChannel = channelName;
            await initializeChannel();

        } catch (error) {
            console.error('Auth verification failed:', error);
            window.location.href = '';
        }
    }
});

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
    await loadStreamInfo();
    setInterval(loadStreamInfo, 60000);
    // Load stream info and mod stats
    await Promise.all([
        loadStreamInfo(),
        loadModStats()
    ]);

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

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/channels/${currentChannel}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        channelData = await response.json();

        // Update UI with channel data
        document.getElementById('channelName').textContent = channelData.display_name;
        document.getElementById('channelAvatar').src = channelData.profile_image_url;
        document.getElementById('breadcrumbChannel').textContent = channelData.display_name;

        // Update follower count
        document.getElementById('followerCount').textContent = channelData.followers.toLocaleString();

        // Update broadcaster type
        const broadcasterType = channelData.broadcaster_type || 'streamer';
        const typeElement = document.getElementById('broadcasterType');
        typeElement.textContent = broadcasterType;
        typeElement.className = `broadcaster-type ${broadcasterType}`;



        // Load additional data
        await loadStreamInfo();
        await loadModStats();

    } catch (error) {
        console.error('Failed to load channel data:', error);
        const statusElement = document.getElementById('channelStatus');
        statusElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Error</span>';
        statusElement.className = 'connection-status error';

        const typeElement = document.getElementById('broadcasterType');
        typeElement.textContent = 'Error';
        typeElement.className = 'broadcaster-type streamer';
    }
}
// Update the updateConnectionStatus function (around line 100)
function updateConnectionStatus() {
    const statusElement = document.getElementById('channelStatus');

    if (channelData && channelData.channelData) {
        statusElement.innerHTML = '<i class="fas fa-circle status-icon"></i> Connected';
        statusElement.className = 'badge badge-success';
    } else {
        statusElement.innerHTML = '<i class="fas fa-circle status-icon"></i> Disconnected';
        statusElement.className = 'badge badge-danger';
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

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Update stream status indicator in header
        updateStreamStatusIndicator(data.isLive);

        // Update stream info section
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

        // Update title and category
        titleElement.textContent = data.title || 'No title set';
        categoryElement.textContent = data.category || 'No category set';

        // Set values in form inputs
        document.getElementById('streamTitleInput').value = data.title || '';
        document.getElementById('streamCategoryInput').value = data.category || '';

    } catch (error) {
        console.error('Failed to load stream info:', error);

        // Update status indicator to show error/offline state
        updateStreamStatusIndicator(false);

        // Set default values when there's an error
        document.getElementById('streamStatus').innerHTML = '<i class="fas fa-circle status-icon"></i> Offline (Error)';
        document.getElementById('streamStatus').className = 'info-value status-offline';
        document.getElementById('streamTitle').textContent = 'No title set';
        document.getElementById('streamCategory').textContent = 'No category set';
        document.getElementById('streamStarted').textContent = '-';

        document.getElementById('streamTitleInput').value = '';
        document.getElementById('streamCategoryInput').value = '';
    }
}

// New helper function to update the status indicator in the header
function updateStreamStatusIndicator(isLive) {
    const statusIndicator = document.querySelector('.stream-status-indicator');
    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('.status-text');

    if (isLive) {
        statusIndicator.classList.add('live');
        statusDot.style.backgroundColor = 'var(--success)';
        statusDot.classList.add('status-pulse');
        statusText.textContent = 'Live';
    } else {
        statusIndicator.classList.remove('live');
        statusDot.style.backgroundColor = 'var(--text-secondary)';
        statusDot.classList.remove('status-pulse');
        statusText.textContent = 'Offline';
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

    // Unban User
    document.getElementById('unbanUser').addEventListener('click', handleUnbanUser);
    // Timeout User
    document.getElementById('timeoutUser').addEventListener('click', handleTimeoutUser);

    // Untimeout User
    document.getElementById('untimeoutUser').addEventListener('click', handleUntimeoutUser);
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

    if (!username) {
        showResult('banResult', 'Please enter a username', 'error');
        return;
    }

    await handleApiCall(
        'Ban',
        'ban',
        { userId: await getUserId(username), reason },
        `Successfully banned {username}`,
        'banResult'
    );

    // Clear fields and refresh on success
    document.getElementById('banUsername').value = '';
    document.getElementById('banReason').value = '';
    loadModStats();
}

async function handleUnbanUser() {
    const username = document.getElementById('banUsername').value.trim();

    if (!username) {
        showResult('banResult', 'Please enter a username', 'error');
        return;
    }

    await handleApiCall(
        'Unban',
        'unban',
        { userId: await getUserId(username) },
        `Successfully unbanned {username}`,
        'banResult'
    );

    // Clear fields and refresh on success
    document.getElementById('banUsername').value = '';
    document.getElementById('banReason').value = '';
    loadModStats();
}

async function handleUnbanUser() {
    const username = document.getElementById('banUsername').value.trim();
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

        // Unban user
        const unbanResponse = await fetch(`/api/${currentChannel}/unban`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });

        if (!unbanResponse.ok) {
            const errorData = await unbanResponse.json();
            throw new Error(errorData.error || 'Unban failed');
        }

        showResult(resultElement, `Successfully unbanned ${username}`, 'success');
        document.getElementById('banUsername').value = '';
        document.getElementById('banReason').value = '';

        // Refresh mod stats
        loadModStats();
    } catch (error) {
        console.error('Unban error:', error);
        showResult(resultElement, `Failed to unban ${username}: ${error.message}`, 'error');
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
                reason: reason || null
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

async function handleUntimeoutUser() {
    const username = document.getElementById('timeoutUsername').value.trim();
    const resultElement = document.getElementById('timeoutResult');

    if (!username) {
        showResult(resultElement, 'Please enter a username', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const userId = await getUserId(username);

        const response = await fetch(`/api/${currentChannel}/untimeout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.message || 'Untimeout failed');
        }

        showResult(resultElement, `Successfully removed timeout for ${username}`, 'success');
        document.getElementById('timeoutUsername').value = '';
        document.getElementById('timeoutReason').value = '';

        // Refresh mod stats
        loadModStats();
    } catch (error) {
        console.error('Untimeout error:', error);
        showResult(resultElement, `Failed to remove timeout: ${error.message}`, 'error');
    }
}

async function handleModAction(action) {
    const elementPrefix = action === 'vip' || action === 'unvip' ? 'vip' : 'mod';
    const username = document.getElementById(`${elementPrefix}Username`).value.trim();

    if (!username) {
        showResult(`${elementPrefix}Result`, 'Please enter a username', 'error');
        return;
    }

    const actionText = {
        'mod': { verb: 'added', as: 'moderator' },
        'unmod': { verb: 'removed', as: 'moderator' },
        'vip': { verb: 'added', as: 'VIP' },
        'unvip': { verb: 'removed', as: 'VIP' }
    }[action];

    const success = await handleApiCall(
        actionText.as.charAt(0).toUpperCase() + actionText.as.slice(1),
        action,
        { userId: await getUserId(username) },
        `Successfully ${actionText.verb} {username} as ${actionText.as}`,
        `${elementPrefix}Result`
    );

    if (success) {
        document.getElementById(`${elementPrefix}Username`).value = '';
        if (action === 'mod' || action === 'unmod') loadModStats();
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
            showResult(resultElement, `Successfully ran commercial for ${length} seconds`, 'success');
            addCommercialToHistory(length);
        } else {
            // Use the API's error message if available
            const errorMsg = result.message || result.error || 'Unknown error';
            showResult(resultElement, `Commercial failed: ${errorMsg}`, 'error');
        }
    } catch (error) {
        console.error('Commercial error:', error);

        // Try to get the detailed error message from the response
        let errorMsg = 'Failed to run commercial';
        try {
            const errorData = await error.json();
            errorMsg = errorData.message || errorData.error || errorMsg;
        } catch (e) {
            // If we can't parse the error response, use the generic message
            errorMsg = error.message;
        }

        showResult(resultElement, `Commercial failed: ${errorMsg}`, 'error');
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
    const currentCategory = document.getElementById('streamCategory').textContent;

    if (!title) {
        showResult(resultElement, 'Please enter a title', 'error');
        return;
    }

    try {
        const token = localStorage.getItem('authToken');
        const requestBody = {
            title: title
        };

        // Only include category in the request if it's not empty
        if (category) {
            requestBody.game_name = category;
        } else {
            // If category is empty, keep the current one
            requestBody.game_name = currentCategory !== 'No category set' ? currentCategory : '';
        }

        const response = await fetch(`/api/${currentChannel}/stream-info`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (response.ok) {
            let successMessage = 'Title updated successfully';
            if (category) {
                successMessage = 'Stream info updated successfully';
            } else if (currentCategory !== 'No category set') {
                successMessage = 'Title updated (category unchanged)';
            }

            showResult(resultElement, successMessage, 'success');

            // Update the displayed info
            document.getElementById('streamTitle').textContent = title;
            if (category) {
                document.getElementById('streamCategory').textContent = category;
            }

            // Refresh the stream info to get the latest data
            await loadStreamInfo();
        } else {
            const errorMessage = result.error || result.details || 'Update failed for unknown reason';
            showResult(resultElement, `Update failed: ${errorMessage}`, 'error');
        }
    } catch (error) {
        console.error('Update error:', error);
        showResult(resultElement, 'Update failed - please try again', 'error');
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

async function getUserId(username) {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/${currentChannel}/user-id?username=${encodeURIComponent(username)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.message || 'User not found');
        }

        const { userId } = await response.json();
        return userId;
    } catch (error) {
        throw new Error(`Failed to get user ID: ${error.message}`);
    }
}

function showResult(element, message, type) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }

    if (!element) return;

    element.textContent = message;
    element.className = `result-message ${type}`;

    // Clear after 5 seconds
    setTimeout(() => {
        element.textContent = '';
        element.className = 'result-message';
    }, 5000);
}

async function handleApiCall(actionName, endpoint, requestData, successMessage, resultElementId) {
    const resultElement = document.getElementById(resultElementId);
    const username = requestData.username || '';

    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`/api/${currentChannel}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (response.ok) {
            const message = successMessage.replace('{username}', username);
            showResult(resultElement, message, 'success');
            return true;
        } else {
            throw new Error(result.error || result.message || `${actionName} failed`);
        }
    } catch (error) {
        console.error(`${actionName} error:`, error);
        showResult(resultElement, `${actionName} failed: ${error.message}`, 'error');
        return false;
    }
}

// Auto-refresh token status every minute
setInterval(updateConnectionStatus, 60000);

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-combo')) {
        document.getElementById('categoryResults').classList.remove('show');
    }
});