let currentChannel = null;
let channelData = null;
let modStatsChart = null;

// Initialize channel page
document.addEventListener('DOMContentLoaded', async () => {
    currentChannel = new URLSearchParams(window.location.search).get('channel');
    if (!currentChannel) {
        window.location.href = '/hub';
        return;
    }

    // Load channel data
    await loadChannelData();

    // Set up navigation
    setupNavigation();

    // Load initial section
    showSection('moderation');

    // Set up action handlers
    setupActionHandlers();

    document.getElementById('statsTimeframe').addEventListener('change', loadModStats);
    loadModStats();

});

async function loadChannelData() {
    try {
        // Load channel info
        const response = await fetch(`/api/channels`);
        const channels = await response.json();
        channelData = channels.find(c => c.login === currentChannel);

        if (!channelData) {
            throw new Error('Channel not found');
        }

        // Update UI
        document.getElementById('channelName').textContent = channelData.display_name;
        document.getElementById('channelAvatar').src = channelData.profile_image_url;

        // Update status
        updateConnectionStatus();

        // Load stream info
        await loadStreamInfo();

    } catch (error) {
        console.error('Failed to load channel data:', error);
        alert('Failed to load channel data');
        window.location.href = '/hub';
    }
}




function updateConnectionStatus() {
    const statusElement = document.getElementById('channelStatus');
    const tokenStatusElement = document.getElementById('tokenStatus');

    if (channelData.status === 'connected') {
        statusElement.textContent = 'Connected';
        statusElement.className = 'badge status-connected';
    } else {
        statusElement.textContent = 'Disconnected';
        statusElement.className = 'badge status-expired';
    }

    // Token expiration info
    const expiresAt = new Date(channelData.expiresAt);
    const refreshAt = new Date(channelData.refreshAt);
    const now = new Date();

    if (now > expiresAt) {
        tokenStatusElement.textContent = 'Token expired';
        tokenStatusElement.className = 'badge status-expired';
    } else if (now > refreshAt) {
        tokenStatusElement.textContent = `Token refreshes soon (${Math.round((expiresAt - now) / 1000 / 60)} min left)`;
        tokenStatusElement.className = 'badge status-warning';
    } else {
        tokenStatusElement.textContent = `Token valid (${Math.round((expiresAt - now) / 1000 / 60)} min left)`;
        tokenStatusElement.className = 'badge status-connected';
    }
}

async function loadStreamInfo() {
    try {
        const response = await fetch(`/api/${currentChannel}/stream-info`);
        const data = await response.json();

        document.getElementById('streamStatus').textContent = data.isLive ?
            `Live since ${new Date(data.startedAt).toLocaleString()}` : 'Offline';
        document.getElementById('streamStatus').className = data.isLive ?
            'stream-info-value status-live' : 'stream-info-value';

        document.getElementById('streamTitle').textContent = data.title || 'No title set';
        document.getElementById('streamCategory').textContent = data.category || 'No category set';

        // Set values in form
        document.getElementById('streamTitleInput').value = data.title || '';
        document.getElementById('streamCategoryInput').value = data.category || '';

    } catch (error) {
        console.error('Failed to load stream info:', error);
        document.getElementById('streamStatus').textContent = 'Error loading stream info';
    }
}

function setupNavigation() {
    const navLinks = document.querySelectorAll('.side-nav a');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show section
            showSection(link.getAttribute('href').substring(1));
        });
    });
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section-content').forEach(section => {
        section.style.display = 'none';
    });

    // Show requested section
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
    }
}

function setupActionHandlers() {
    document.getElementById('banUser').addEventListener('click', async () => {
        const username = document.getElementById('banUsername').value.trim();
        const reason = document.getElementById('banReason').value.trim();

        if (!username) {
            showResult('banResult', 'Please enter a username', 'error');
            return;
        }

        try {
            const userId = await getUserId(username);
            if (!userId) {
                showResult('banResult', `User "${username}" not found`, 'error');
                return;
            }

            const response = await fetch(`/api/${currentChannel}/ban`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    reason: reason || ' '
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Ban failed');
            }

            showResult('banResult', `${username} has been banned`, 'success');
            document.getElementById('banUsername').value = '';
            document.getElementById('banReason').value = '';
        } catch (error) {
            console.error('Ban error:', error);
            showResult('banResult', `Ban failed: ${error.message}`, 'error');
        }
    });
    document.getElementById('unbanUser')?.addEventListener('click', async () => {
        const username = document.getElementById('unbanUsername').value.trim();

        if (!username) {
            showResult('unbanResult', 'Please enter a username', 'error');
            return;
        }

        try {
            const userId = await getUserId(username);
            if (!userId) {
                showResult('unbanResult', `User "${username}" not found`, 'error');
                return;
            }

            const response = await fetch(`/api/${currentChannel}/unban`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Unban failed');
            }

            showResult('unbanResult', `${username} has been unbanned`, 'success');
            document.getElementById('unbanUsername').value = '';
        } catch (error) {
            console.error('Unban error:', error);
            showResult('unbanResult', `Unban failed: ${error.message}`, 'error');
        }
    });
    // Timeout user
    document.getElementById('timeoutUser').addEventListener('click', async () => {
        const username = document.getElementById('timeoutUsername').value.trim();
        const duration = document.getElementById('timeoutDuration').value;
        const reason = document.getElementById('timeoutReason').value.trim();

        if (!username) {
            showResult('timeoutResult', 'Please enter a username', 'error');
            return;
        }

        try {
            const userId = await getUserId(username);
            if (!userId) {
                showResult('timeoutResult', `User "${username}" not found`, 'error');
                return;
            }

            const response = await fetch(`/api/${currentChannel}/timeout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    duration,
                    reason: reason || 'Timed out via Stream Manager'
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Timeout failed');
            }

            showResult('timeoutResult', `${username} has been timed out for ${duration / 60} minutes`, 'success');
            document.getElementById('timeoutUsername').value = '';
            document.getElementById('timeoutReason').value = '';
        } catch (error) {
            console.error('Timeout error:', error);
            showResult('timeoutResult', `Timeout failed: ${error.message}`, 'error');
        }
    });

    // Run commercial
    document.getElementById('runCommercial').addEventListener('click', async () => {
        const length = document.getElementById('commercialLength').value;

        try {
            const response = await fetch(`/api/${currentChannel}/commercial`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ length })
            });

            const result = await response.json();

            if (response.ok) {
                showResult('commercialResult', `Commercial started for ${length} seconds`, 'success');
            } else {
                showResult('commercialResult', `Commercial failed: ${result.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            console.error('Commercial error:', error);
            showResult('commercialResult', 'Commercial failed - check console', 'error');
        }
    });

    // Add/remove mod
    document.getElementById('modUser').addEventListener('click', async () => {
        await handleModAction('mod');
    });

    document.getElementById('unmodUser').addEventListener('click', async () => {
        await handleModAction('unmod');
    });

    // Add/remove VIP
    document.getElementById('addVip').addEventListener('click', async () => {
        await handleModAction('vip');
    });

    document.getElementById('removeVip').addEventListener('click', async () => {
        await handleModAction('unvip');
    });

    // Update stream info
    document.getElementById('updateStreamInfo').addEventListener('click', async () => {
        const title = document.getElementById('streamTitleInput').value.trim();
        const category = document.getElementById('streamCategoryInput').value.trim();

        if (!title) {
            showResult('streamUpdateResult', 'Please enter a title', 'error');
            return;
        }

        try {
            // In a real app, you'd look up the game ID from the category name
            const response = await fetch(`/api/${currentChannel}/stream-info`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    gameId: '' // You'd need to implement game ID lookup
                })
            });

            const result = await response.json();

            if (response.ok) {
                showResult('streamUpdateResult', 'Stream info updated successfully', 'success');
                await loadStreamInfo(); // Refresh displayed info
            } else {
                showResult('streamUpdateResult', `Update failed: ${result.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            console.error('Update error:', error);
            showResult('streamUpdateResult', 'Update failed - check console', 'error');
        }
    });
}

async function handleModAction(action) {
    const usernameElement = document.getElementById(`${action === 'vip' || action === 'unvip' ? 'vip' : 'mod'}Username`);
    const username = usernameElement.value.trim();
    const resultElement = document.getElementById(`${action === 'vip' || action === 'unvip' ? 'vip' : 'mod'}Result`);

    if (!username) {
        showResult(resultElement.id, 'Please enter a username', 'error');
        return;
    }

    try {
        // First get user ID
        const userId = await getUserId(username);
        if (!userId) {
            showResult(resultElement.id, `User "${username}" not found`, 'error');
            return;
        }

        const response = await fetch(`/api/${currentChannel}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Action failed');
        }

        const actionText = {
            'mod': 'moderator',
            'unmod': 'removed as moderator',
            'vip': 'VIP',
            'unvip': 'removed as VIP'
        }[action];

        showResult(resultElement.id, `${username} has been ${actionText}`, 'success');
        usernameElement.value = '';
    } catch (error) {
        console.error(`${action} error:`, error);
        showResult(resultElement.id, `${actionText || 'Action'} failed: ${error.message}`, 'error');
    }

    await loadModStats();
}

async function getUserId(username) {
    try {
        // Encode the username for URL safety
        const encodedUsername = encodeURIComponent(username);
        const response = await fetch(`/api/${currentChannel}/user-id?username=${encodedUsername}`);

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const data = await response.json();
        return data.userId;
    } catch (error) {
        console.error('User lookup error:', error);
        showResult('banResult', `Failed to find user: ${error.message}`, 'error');
        return null;
    }
}


async function loadModStats() {
    try {
        const timeframe = document.getElementById('statsTimeframe').value;
        const response = await fetch(`/api/${currentChannel}/mod-stats?days=${timeframe}`);
        const stats = await response.json();

        // Update table
        const tbody = document.getElementById('modStatsBody');
        tbody.innerHTML = '';

        stats.forEach((mod, index) => {
            const row = document.createElement('tr');
            const actionsPerDay = (timeframe > 0 ? (mod.totalActions / timeframe).toFixed(2) : '-');

            row.innerHTML = `
                <td>${mod.moderatorName}</td>
                <td>${mod.totalActions}</td>
                <td>${mod.timeouts}</td>
                <td>${mod.bans}</td>
                <td>${actionsPerDay}</td>
            `;

            // Highlight top mod
            if (index === 0) {
                row.classList.add('top-mod');
            }

            tbody.appendChild(row);
        });

        // Update chart
        updateModStatsChart(stats);
    } catch (error) {
        console.error('Failed to load mod stats:', error);
    }
}

function updateModStatsChart(stats) {
    const ctx = document.getElementById('modStatsChart').getContext('2d');
    const topMods = stats.slice(0, 5); // Show top 5 mods

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
                    color: 'var(--text-light)'
                },
                legend: {
                    labels: {
                        color: 'var(--text-light)'
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: 'var(--text-light)'
                    },
                    grid: {
                        color: 'var(--medium-gray)'
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: 'var(--text-light)'
                    },
                    grid: {
                        color: 'var(--medium-gray)'
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