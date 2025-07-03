// Admin dashboard functionality
function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tabName).classList.add('active');
    
    // Add active class to selected tab
    document.querySelector(`.tab[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    // Load data for the selected tab
    switch(tabName) {
        case 'users':
            loadUsers();
            break;
        case 'redemptions':
            loadRedemptions();
            break;
        case 'promotions':
            // No data to load
            break;
        case 'settings':
            loadSettings();
            break;
        case 'duplicates':
            loadDuplicates();
            break;
    }
}

// Loading indicators
function showLoading(elementId) {
    document.getElementById(elementId).style.display = 'block';
}

function hideLoading(elementId) {
    document.getElementById(elementId).style.display = 'none';
}

// Error handling
function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}

// Success messages
function showSuccess(elementId, message) {
    const successElement = document.getElementById(elementId);
    successElement.textContent = message;
    successElement.style.display = 'block';
    setTimeout(() => {
        successElement.style.display = 'none';
    }, 5000);
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/admin/stats');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('totalRevenue').textContent = `KSh ${data.stats.totalRevenue.toLocaleString()}`;
            document.getElementById('totalTransactions').textContent = data.stats.totalTransactions.toLocaleString();
            document.getElementById('totalCustomers').textContent = data.stats.totalCustomers.toLocaleString();
            document.getElementById('averageTransaction').textContent = `KSh ${Math.round(data.stats.averageTransaction).toLocaleString()}`;
            document.getElementById('databaseSize').textContent = data.stats.databaseSize;
            document.getElementById('lastBackup').textContent = data.stats.lastBackup || 'Never';
            document.getElementById('lastOptimization').textContent = data.stats.lastOptimization || 'Never';
        } else {
            showError('statsError', data.message || 'Failed to load statistics');
        }
    } catch (error) {
        showError('statsError', 'Failed to load statistics');
    }
}

// Load system health
async function loadSystemHealth() {
    try {
        const response = await fetch('/admin/health');
        const data = await response.json();
        
        if (data.success) {
            updateSystemHealth(data.health);
        } else {
            showError('healthError', data.message || 'Failed to load system health');
        }
    } catch (error) {
        showError('healthError', 'Failed to load system health');
    }
}

function updateSystemHealth(health) {
    document.getElementById('databaseHealth').textContent = health.database ? '✅ Connected' : '❌ Disconnected';
    document.getElementById('whatsappHealth').textContent = health.whatsapp ? '✅ Connected' : '❌ Disconnected';
    document.getElementById('paymentHealth').textContent = health.payment ? '✅ Connected' : '❌ Disconnected';
}

// Load referral program status
async function loadReferralStatus() {
    try {
        const response = await fetch('/admin/settings/referral');
        const data = await response.json();
        
        if (data.success) {
            const toggle = document.getElementById('referralToggle');
            toggle.checked = data.enabled;
            document.getElementById('referralStatus').textContent = data.enabled ? 'Active' : 'Paused';
        } else {
            showError('settingsError', data.message || 'Failed to load referral status');
        }
    } catch (error) {
        showError('settingsError', 'Failed to load referral status');
    }
}

// Toggle referral program
async function toggleReferralProgram() {
    const toggle = document.getElementById('referralToggle');
    const newStatus = toggle.checked;
    
    try {
        const response = await fetch('/admin/settings/referral', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled: newStatus })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('referralStatus').textContent = newStatus ? 'Active' : 'Paused';
            showSuccess('settingsSuccess', `Referral program ${newStatus ? 'activated' : 'paused'} successfully`);
        } else {
            toggle.checked = !newStatus; // Revert toggle
            showError('settingsError', data.message || 'Failed to update referral status');
        }
    } catch (error) {
        toggle.checked = !newStatus; // Revert toggle
        showError('settingsError', 'Failed to update referral status');
    }
}

// Load settings
async function loadSettings() {
    showLoading('settingsLoading');
    try {
        await Promise.all([
            loadStats(),
            loadSystemHealth(),
            loadReferralStatus()
        ]);
    } catch (error) {
        showError('settingsError', 'Failed to load settings');
    } finally {
        hideLoading('settingsLoading');
    }
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    // Load initial data
    loadStats();
    loadSystemHealth();
    loadReferralStatus();
    
    // Add event listeners
    document.getElementById('referralToggle').addEventListener('change', toggleReferralProgram);
    document.getElementById('refreshStats').addEventListener('click', loadStats);
    document.getElementById('checkHealth').addEventListener('click', loadSystemHealth);
    
    // Show users tab by default
    showTab('users');
});

// User management
async function loadUsers() {
    showLoading('usersLoading');
    try {
        const response = await fetch('/admin/users');
        const result = await response.json();
        
        const allUsers = document.getElementById('allUsers');
        if (result.users && result.users.length > 0) {
            let html = '<table><tr><th>Username</th><th>Phone</th><th>Referral Code</th><th>Referrals</th><th>Total Spent</th><th>Points</th><th>Actions</th></tr>';
            result.users.forEach(user => {
                html += '<tr>';
                html += '<td>' + escapeHtml(user.username) + '</td>';
                html += '<td>' + escapeHtml(user.phone) + '</td>';
                html += '<td>' + escapeHtml(user.referral_code) + '</td>';
                html += '<td>' + user.total_referrals + '</td>';
                html += '<td>KES ' + user.total_spent + '</td>';
                html += '<td>' + user.total_points + '</td>';
                html += '<td><button onclick="deleteUser(\'' + user.phone + '\')" class="action-btn cleanup">Delete</button></td>';
                html += '</tr>';
            });
            html += '</table>';
            allUsers.innerHTML = html;
        } else {
            allUsers.innerHTML = '<p>No users found</p>';
        }
    } catch (error) {
        showError('usersError', 'Error loading users: ' + error.message);
    } finally {
        hideLoading('usersLoading');
    }
}

async function searchUsers() {
    const searchInput = document.getElementById('searchInput').value.trim();
    if (!searchInput) {
        showError('usersError', 'Please enter a phone number to search');
        return;
    }
    
    showLoading('usersLoading');
    try {
        const response = await fetch('/admin/users/search?phone=' + encodeURIComponent(searchInput));
        const result = await response.json();
        
        const searchResults = document.getElementById('searchResults');
        if (result.users && result.users.length > 0) {
            let html = '<h3>Search Results</h3><table><tr><th>Phone</th><th>Username</th><th>Points</th><th>Actions</th></tr>';
            result.users.forEach(user => {
                html += '<tr>';
                html += '<td>' + escapeHtml(user.phone) + '</td>';
                html += '<td>' + escapeHtml(user.username) + '</td>';
                html += '<td>' + user.points + '</td>';
                html += '<td><button onclick="deleteUser(\'' + user.phone + '\')" class="action-btn cleanup">Delete</button></td>';
                html += '</tr>';
            });
            html += '</table>';
            searchResults.innerHTML = html;
        } else {
            searchResults.innerHTML = '<p>No users found</p>';
        }
    } catch (error) {
        showError('usersError', 'Error searching users: ' + error.message);
    } finally {
        hideLoading('usersLoading');
    }
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
    loadUsers();
}

async function deleteUser(phone) {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        showLoading('usersLoading');
        try {
            const response = await fetch('/admin/users/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phone })
            });
            
            const result = await response.json();
            if (result.success) {
                showSuccess('usersSuccess', result.message);
                loadUsers();
            } else {
                showError('usersError', result.error || 'Error deleting user');
            }
        } catch (error) {
            showError('usersError', 'Error deleting user: ' + error.message);
        } finally {
            hideLoading('usersLoading');
        }
    }
}

// Redemption management
async function loadRedemptions() {
    showLoading('redemptionsLoading');
    try {
        const status = document.getElementById('redemptionStatus').value;
        const date = document.getElementById('redemptionDate').value;
        
        const response = await fetch(`/admin/redemptions?status=${status}&date=${date}`);
        const result = await response.json();
        
        const redemptionList = document.getElementById('redemptionList');
        if (result.redemptions && result.redemptions.length > 0) {
            let html = '';
            result.redemptions.forEach(redemption => {
                html += `
                    <div class="redemption-card">
                        <div class="redemption-header">
                            <span class="redemption-id">Request #${redemption.id}</span>
                            <span class="redemption-status ${redemption.status}">${redemption.status.toUpperCase()}</span>
                        </div>
                        <div class="redemption-details">
                            <div class="redemption-detail">
                                <span class="detail-label">User</span>
                                <span class="detail-value">${escapeHtml(redemption.username)}</span>
                            </div>
                            <div class="redemption-detail">
                                <span class="detail-label">Phone</span>
                                <span class="detail-value">${escapeHtml(redemption.phone)}</span>
                            </div>
                            <div class="redemption-detail">
                                <span class="detail-label">Points</span>
                                <span class="detail-value">${redemption.points}</span>
                            </div>
                            <div class="redemption-detail">
                                <span class="detail-label">Requested</span>
                                <span class="detail-value">${new Date(redemption.created_at).toLocaleString()}</span>
                            </div>
                        </div>
                        ${redemption.status === 'pending' ? `
                            <div class="redemption-actions">
                                <button onclick="handleRedemption(${redemption.id}, 'approve')" class="action-btn optimize">
                                    <span class="icon">✅</span> Approve
                                </button>
                                <button onclick="handleRedemption(${redemption.id}, 'reject')" class="action-btn cleanup">
                                    <span class="icon">❌</span> Reject
                                </button>
                                <button onclick="handleRedemption(${redemption.id}, 'cancel')" class="action-btn refresh">
                                    <span class="icon">🚫</span> Cancel
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            redemptionList.innerHTML = html;
        } else {
            redemptionList.innerHTML = '<p>No redemption requests found</p>';
        }
    } catch (error) {
        showError('redemptionsError', 'Error loading redemptions: ' + error.message);
    } finally {
        hideLoading('redemptionsLoading');
    }
}

// Promotions management
async function loadPromotions() {
    showLoading('promotionsLoading');
    try {
        const response = await fetch('/admin/promotions');
        const result = await response.json();
        
        const promotionsList = document.getElementById('promotionsList');
        if (result.promotions && result.promotions.length > 0) {
            let html = '';
            result.promotions.forEach(promotion => {
                html += `
                    <div class="promotion-card">
                        <div class="promotion-header">
                            <h3>${escapeHtml(promotion.title)}</h3>
                            <span class="promotion-date">${new Date(promotion.created_at).toLocaleString()}</span>
                        </div>
                        <div class="promotion-message">
                            ${escapeHtml(promotion.message)}
                        </div>
                        <div class="promotion-actions">
                            <button onclick="editPromotion(${promotion.id})" class="action-btn optimize">
                                <span class="icon">✏️</span> Edit
                            </button>
                            <button onclick="deletePromotion(${promotion.id})" class="action-btn cleanup">
                                <span class="icon">🗑️</span> Delete
                            </button>
                        </div>
                    </div>
                `;
            });
            promotionsList.innerHTML = html;
        } else {
            promotionsList.innerHTML = '<p>No promotions found</p>';
        }
    } catch (error) {
        showError('promotionsError', 'Error loading promotions: ' + error.message);
    } finally {
        hideLoading('promotionsLoading');
    }
}

async function editPromotion(id) {
    const title = prompt('Enter new title:');
    if (!title) return;
    
    const message = prompt('Enter new message:');
    if (!message) return;
    
    showLoading('promotionsLoading');
    try {
        const response = await fetch(`/admin/promotions/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, message })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('promotionsSuccess', result.message);
            loadPromotions();
        } else {
            showError('promotionsError', result.error || 'Error updating promotion');
        }
    } catch (error) {
        showError('promotionsError', 'Error updating promotion: ' + error.message);
    } finally {
        hideLoading('promotionsLoading');
    }
}

async function deletePromotion(id) {
    if (!confirm('Are you sure you want to delete this promotion?')) return;
    
    showLoading('promotionsLoading');
    try {
        const response = await fetch(`/admin/promotions/${id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('promotionsSuccess', result.message);
            loadPromotions();
        } else {
            showError('promotionsError', result.error || 'Error deleting promotion');
        }
    } catch (error) {
        showError('promotionsError', 'Error deleting promotion: ' + error.message);
    } finally {
        hideLoading('promotionsLoading');
    }
}

// Duplicate accounts management
async function loadDuplicates() {
    showLoading('duplicatesLoading');
    try {
        const response = await fetch('/admin/duplicates');
        const result = await response.json();
        
        const duplicatesTableBody = document.getElementById('duplicatesTableBody');
        if (result.duplicates && result.duplicates.length > 0) {
            let html = '';
            result.duplicates.forEach(duplicate => {
                html += `
                    <tr>
                        <td>${escapeHtml(duplicate.phone)}</td>
                        <td>${duplicate.count}</td>
                        <td>
                            <button onclick="mergeDuplicates('${duplicate.phone}')" class="action-btn optimize">
                                <span class="icon">🔄</span> Merge
                            </button>
                        </td>
                    </tr>
                `;
            });
            duplicatesTableBody.innerHTML = html;
        } else {
            duplicatesTableBody.innerHTML = '<tr><td colspan="3">No duplicate accounts found</td></tr>';
        }
    } catch (error) {
        showError('duplicatesError', 'Error loading duplicates: ' + error.message);
    } finally {
        hideLoading('duplicatesLoading');
    }
}

async function mergeDuplicates(phone) {
    if (!confirm('Are you sure you want to merge these duplicate accounts?')) return;
    
    showLoading('duplicatesLoading');
    try {
        const response = await fetch('/admin/duplicates/merge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('duplicatesSuccess', result.message);
            loadDuplicates();
        } else {
            showError('duplicatesError', result.error || 'Error merging duplicates');
        }
    } catch (error) {
        showError('duplicatesError', 'Error merging duplicates: ' + error.message);
    } finally {
        hideLoading('duplicatesLoading');
    }
}

// Utility functions
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
} 