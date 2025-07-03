// Admin interface functionality
function showTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.style.display = 'none';
    });

    // Remove active class from all tabs
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.classList.remove('active');
    });

    // Show selected tab content
    const selectedContent = document.getElementById(tabName);
    if (selectedContent) {
        selectedContent.style.display = 'block';
    }

    // Add active class to selected tab
    const selectedTab = document.querySelector(`.tab[onclick="showTab('${tabName}')"]`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    // Load data for the selected tab
    switch (tabName) {
        case 'users':
            loadUsers();
            break;
        case 'redemptions':
            loadRedemptions();
            break;
        case 'promotions':
            loadPromotions();
            break;
        case 'settings':
            loadSettings();
            break;
        case 'duplicates':
            loadDuplicates();
            break;
    }
}

function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = 'block';
    }
}

function hideLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = 'none';
    }
}

function showError(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.display = 'block';
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

function showSuccess(elementId, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.style.display = 'block';
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
}

// Initialize the first tab when the page loads
document.addEventListener('DOMContentLoaded', function() {
    // Show the first tab by default
    showTab('users');
});

// Settings and promotions management
async function saveSettings() {
    showLoading('settingsLoading');
    try {
        const pointsPerReferral = document.getElementById('pointsPerReferral').value;
        const minPointsForRedemption = document.getElementById('minPointsForRedemption').value;
        
        const response = await fetch('/admin/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pointsPerReferral,
                minPointsForRedemption
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('settingsSuccess', result.message);
        } else {
            showError('settingsError', result.error || 'Error saving settings');
        }
    } catch (error) {
        showError('settingsError', 'Error saving settings: ' + error.message);
    } finally {
        hideLoading('settingsLoading');
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

async function loadSettings() {
    showLoading('settingsLoading');
    try {
        const response = await fetch('/admin/settings');
        const result = await response.json();
        
        const referralStatus = result.settings.referral_program_active === 'true' ? 'Active' : 'Paused';
        const referralButtonText = result.settings.referral_program_active === 'true' ? 'Pause Program' : 'Activate Program';
        
        document.getElementById('referralStatus').textContent = referralStatus;
        document.getElementById('referralToggle').textContent = referralButtonText;
    } catch (error) {
        showError('settingsError', 'Error loading settings: ' + error.message);
    } finally {
        hideLoading('settingsLoading');
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

// Add redemption handling function
async function handleRedemption(id, action) {
    let confirmMessage = '';
    let notes = '';
    
    switch (action) {
        case 'approve':
            confirmMessage = 'Are you sure you want to approve this redemption request?';
            notes = prompt('Enter approval notes (optional):');
            break;
        case 'reject':
            notes = prompt('Please enter a reason for rejection (required):');
            if (notes === null) return; // User cancelled
            if (!notes.trim()) {
                alert('Please provide a reason for rejection');
                return;
            }
            confirmMessage = 'Are you sure you want to reject this redemption request?';
            break;
        case 'cancel':
            confirmMessage = 'Are you sure you want to cancel this redemption request?';
            break;
    }

    if (confirm(confirmMessage)) {
        try {
            const response = await fetch(`/admin/redemption/${action}/${id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ notes })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                let successMessage = '';
                switch (action) {
                    case 'approve':
                        successMessage = 'Redemption approved and user has been notified';
                        break;
                    case 'reject':
                        successMessage = 'Redemption rejected and user has been notified';
                        break;
                    case 'cancel':
                        successMessage = 'Redemption cancelled successfully';
                        break;
                }
                alert(successMessage);
                location.reload();
            } else {
                alert(result.error || `Error ${action}ing redemption`);
            }
        } catch (error) {
            alert(`Error ${action}ing redemption: ${error.message}`);
        }
    }
}

async function sendPromotionalMessage() {
    const message = document.getElementById('promoMessage').value.trim();
    if (!message) {
        showError('promoError', 'Please enter a message');
        return;
    }
    
    if (confirm('Are you sure you want to send this promotional message to all users?')) {
        showLoading('promoLoading');
        try {
            const response = await fetch('/admin/promotion/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                showSuccess('promoSuccess', `Message sent successfully to ${result.successCount} users${result.failCount > 0 ? ` (${result.failCount} failed)` : ''}`);
                document.getElementById('promoMessage').value = '';
                
                // Update the recent messages list
                loadRecentPromotions();
            } else {
                showError('promoError', result.error || 'Error sending message');
            }
        } catch (error) {
            showError('promoError', 'Error sending message: ' + error.message);
        } finally {
            hideLoading('promoLoading');
        }
    }
}

async function loadRecentPromotions() {
    try {
        const response = await fetch('/admin/promotions/recent');
        const result = await response.json();
        
        const recentPromos = document.getElementById('recentPromos');
        if (result.promotions && result.promotions.length > 0) {
            let html = '<div class="recent-promos-list">';
            result.promotions.forEach(promo => {
                html += `
                    <div class="promo-card">
                        <div class="promo-header">
                            <span class="promo-date">${new Date(promo.created_at).toLocaleString()}</span>
                            <span class="promo-status ${promo.status}">${promo.status}</span>
                        </div>
                        <div class="promo-message">${escapeHtml(promo.message)}</div>
                        <div class="promo-stats">
                            <span>Sent: ${promo.success_count || 0}</span>
                            <span>Failed: ${promo.fail_count || 0}</span>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            recentPromos.innerHTML = html;
        } else {
            recentPromos.innerHTML = '<p>No recent promotional messages</p>';
        }
    } catch (error) {
        console.error('Error loading recent promotions:', error);
    }
} 