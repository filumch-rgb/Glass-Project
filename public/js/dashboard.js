/**
 * Dashboard JavaScript for Insurer Portal
 * Handles authentication, data fetching, filtering, and UI interactions
 */

// Global state
let accessCode = null;
let currentFilters = {};
let autoRefreshInterval = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  const storedAccessCode = sessionStorage.getItem('accessCode');
  if (storedAccessCode) {
    accessCode = storedAccessCode;
    showDashboard();
  }
  
  // Setup event listeners
  setupEventListeners();
});

// Setup all event listeners
function setupEventListeners() {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  
  // Header actions
  document.getElementById('refreshBtn').addEventListener('click', refreshDashboard);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  
  // Filters
  document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
  document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
  document.getElementById('exportCsvBtn').addEventListener('click', () => exportData('csv'));
  document.getElementById('exportJsonBtn').addEventListener('click', () => exportData('json'));
  
  // Manual review form
  document.getElementById('manualReviewForm').addEventListener('submit', handleManualReviewSubmit);
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  
  const accessCodeInput = document.getElementById('accessCodeInput').value;
  const errorDiv = document.getElementById('loginError');
  
  try {
    const response = await fetch('/api/dashboard/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accessCode: accessCodeInput }),
    });
    
    const data = await response.json();
    
    if (data.success) {
      accessCode = accessCodeInput;
      sessionStorage.setItem('accessCode', accessCode);
      showDashboard();
    } else {
      errorDiv.textContent = 'Invalid access code. Please try again.';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('Login error:', error);
    errorDiv.textContent = 'Login failed. Please try again.';
    errorDiv.style.display = 'block';
  }
}

// Handle logout
function handleLogout() {
  accessCode = null;
  sessionStorage.removeItem('accessCode');
  stopAutoRefresh();
  
  document.getElementById('dashboardScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('accessCodeInput').value = '';
}

// Show dashboard
function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboardScreen').style.display = 'block';
  
  // Load initial data
  loadDashboardData();
  
  // Start auto-refresh (every 30 seconds)
  startAutoRefresh();
}

// Start auto-refresh
function startAutoRefresh() {
  stopAutoRefresh(); // Clear any existing interval
  autoRefreshInterval = setInterval(() => {
    loadDashboardData();
  }, 30000); // 30 seconds
}

// Stop auto-refresh
function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Load all dashboard data
async function loadDashboardData() {
  await Promise.all([
    loadMetrics(),
    loadClaims(),
  ]);
  
  updateLastRefreshTime();
}

// Refresh dashboard
function refreshDashboard() {
  loadDashboardData();
}

// Update last refresh time
function updateLastRefreshTime() {
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
  document.getElementById('lastRefresh').textContent = `Last updated: ${timeString}`;
}

// Load metrics
async function loadMetrics() {
  try {
    const response = await fetch('/api/dashboard/metrics', {
      headers: {
        'X-Access-Code': accessCode,
      },
    });
    
    if (!response.ok) throw new Error('Failed to load metrics');
    
    const data = await response.json();
    
    // Update metric cards
    document.getElementById('metricTotalClaims').textContent = data.totalClaims;
    document.getElementById('metricAvgTurnaround').textContent = `${data.avgTurnaroundHours} hrs`;
    document.getElementById('metricAutomationRate').textContent = `${data.automationRate}%`;
    document.getElementById('metricManualQueue').textContent = data.manualReview.queueSize;
    document.getElementById('metricOverrideRate').textContent = `${data.manualReview.overrideRate}%`;
  } catch (error) {
    console.error('Failed to load metrics:', error);
  }
}

// Load claims
async function loadClaims() {
  try {
    const queryParams = new URLSearchParams(currentFilters);
    
    const response = await fetch(`/api/dashboard/claims?${queryParams}`, {
      headers: {
        'X-Access-Code': accessCode,
      },
    });
    
    if (!response.ok) throw new Error('Failed to load claims');
    
    const data = await response.json();
    
    // Update claims count
    document.getElementById('claimsCount').textContent = 
      `Showing ${data.claims.length} of ${data.pagination.total} claims`;
    
    // Render claims table
    renderClaimsTable(data.claims);
  } catch (error) {
    console.error('Failed to load claims:', error);
    document.getElementById('claimsTableBody').innerHTML = 
      '<tr><td colspan="8" class="loading-cell">Failed to load claims</td></tr>';
  }
}

// Render claims table
function renderClaimsTable(claims) {
  const tbody = document.getElementById('claimsTableBody');
  
  if (claims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No claims found</td></tr>';
    return;
  }
  
  tbody.innerHTML = claims.map(claim => {
    const sentDate = claim.notificationSentAt 
      ? new Date(claim.notificationSentAt).toLocaleDateString()
      : '--';
    const receivedDate = claim.responseReceivedAt
      ? new Date(claim.responseReceivedAt).toLocaleDateString()
      : '--';
    
    // Calculate days outstanding since notification was sent (until response or now)
    let daysDisplay = '--';
    if (claim.notificationSentAt) {
      const sentTime = new Date(claim.notificationSentAt).getTime();
      if (claim.responseReceivedAt) {
        // Response received — show how long it took
        const responseTime = new Date(claim.responseReceivedAt).getTime();
        const daysTaken = Math.floor((responseTime - sentTime) / (1000 * 60 * 60 * 24));
        daysDisplay = `${daysTaken}d`;
      } else {
        // Still waiting — show days outstanding
        const daysWaiting = Math.floor((Date.now() - sentTime) / (1000 * 60 * 60 * 24));
        daysDisplay = `${daysWaiting}d`;
      }
    }
    
    const statusClass = claim.status.toLowerCase().replace(/\s+/g, '-');
    
    const confidenceBadge = claim.confidence !== null
      ? `<span class="confidence-badge ${getConfidenceClass(claim.confidence)}">
           ${getConfidenceIcon(claim.confidence)} ${(claim.confidence * 100).toFixed(0)}%
         </span>`
      : '--';
    
    const decisionBadge = claim.decision
      ? `<span class="decision-badge decision-${claim.decision.replace(/_/g, '-')}">
           ${formatDecision(claim.decision)}
         </span>`
      : '--';
    
    // Generate reason from actual justification
    const reason = getDecisionReason(claim);
    
    // Determine if resend is available (no response yet - still awaiting photos or message sent)
    const canResend = !claim.decision && 
      (claim.internalStatus === 'intake_received' || claim.internalStatus === 'awaiting_photos');
    
    return `
      <tr>
        <td><strong>${claim.claimNumber}</strong></td>
        <td>${claim.policyholderName}</td>
        <td>${sentDate}</td>
        <td>${receivedDate}</td>
        <td><span class="days-badge ${!claim.responseReceivedAt && claim.notificationSentAt && parseInt(daysDisplay) > 3 ? 'days-overdue' : ''}">${daysDisplay}</span></td>
        <td><span class="status-badge status-${statusClass}">${claim.status}</span></td>
        <td>${confidenceBadge}</td>
        <td>${decisionBadge}</td>
        <td><span class="reason-text">${reason}</span></td>
        <td>
          <button class="action-btn action-btn-view" onclick="viewClaimDetail('${claim.id}')">
            👁️ View
          </button>
          ${canResend ? `
            <button class="action-btn action-btn-resend" onclick="resendNotification('${claim.id}')">
              📤 Resend
            </button>
          ` : ''}
          ${claim.decision ? `
            <button class="action-btn action-btn-review" onclick="openManualReviewModal('${claim.id}')">
              🔍 Review
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// Get confidence class
function getConfidenceClass(confidence) {
  if (confidence >= 0.7) return 'confidence-high';
  if (confidence >= 0.6) return 'confidence-medium';
  return 'confidence-low';
}

// Get confidence icon
function getConfidenceIcon(confidence) {
  if (confidence >= 0.7) return '🟢';
  if (confidence >= 0.6) return '🟡';
  return '🔴';
}

// Format decision
function formatDecision(decision) {
  const map = {
    'repair': 'Repair',
    'replace': 'Replace',
    'needs_manual_review': 'Manual Review',
    'insufficient_evidence': 'Insufficient Evidence',
  };
  return map[decision] || decision;
}

// Get decision reason (uses actual justification from decision engine)
function getDecisionReason(claim) {
  // If we have the actual justification from the decision engine, use it
  if (claim.decisionExplanation) {
    return claim.decisionExplanation;
  }
  
  if (!claim.decision) {
    // No decision yet - show status-based reason
    if (claim.internalStatus === 'intake_received') {
      return 'Awaiting photos';
    } else if (claim.internalStatus === 'awaiting_photos') {
      return 'Photos in progress';
    } else {
      return 'Processing...';
    }
  }
  
  return 'Decision pending';
}

// Apply filters
function applyFilters() {
  const status = document.getElementById('filterStatus').value;
  const decision = document.getElementById('filterDecision').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;
  
  currentFilters = {};
  
  if (status) currentFilters.status = status;
  if (decision) currentFilters.decision = decision;
  if (dateFrom) currentFilters.dateFrom = new Date(dateFrom).toISOString();
  if (dateTo) currentFilters.dateTo = new Date(dateTo).toISOString();
  
  loadClaims();
}

// Clear filters
function clearFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterDecision').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  
  currentFilters = {};
  loadClaims();
}

// Export data
async function exportData(format) {
  try {
    const queryParams = new URLSearchParams({
      ...currentFilters,
      format,
    });
    
    const response = await fetch(`/api/dashboard/export?${queryParams}`, {
      headers: {
        'X-Access-Code': accessCode,
      },
    });
    
    if (!response.ok) throw new Error('Export failed');
    
    // Download file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claims-export-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Export failed:', error);
    alert('Export failed. Please try again.');
  }
}

// View claim detail
async function viewClaimDetail(claimId) {
  try {
    const response = await fetch(`/api/dashboard/claims/${claimId}`, {
      headers: {
        'X-Access-Code': accessCode,
      },
    });
    
    if (!response.ok) throw new Error('Failed to load claim details');
    
    const claim = await response.json();
    
    // Render claim detail modal
    renderClaimDetailModal(claim);
    
    // Show modal
    document.getElementById('claimDetailModal').style.display = 'flex';
  } catch (error) {
    console.error('Failed to load claim details:', error);
    alert('Failed to load claim details. Please try again.');
  }
}

// Render claim detail modal
function renderClaimDetailModal(claim) {
  const modalBody = document.getElementById('claimDetailBody');
  
  const decision = claim.inspectionData?.decision;
  const confidence = decision?.confidenceSummary 
    ? Object.values(decision.confidenceSummary).reduce((a, b) => a + b, 0) / Object.values(decision.confidenceSummary).length
    : null;
  
  modalBody.innerHTML = `
    <div class="detail-section">
      <h3>Claim Information</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Claim Number</div>
          <div class="detail-value"><strong>${claim.claimNumber}</strong></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Status</div>
          <div class="detail-value">${claim.status}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Received At</div>
          <div class="detail-value">${new Date(claim.receivedAt).toLocaleString()}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Notification Sent</div>
          <div class="detail-value">${claim.notificationSentAt ? new Date(claim.notificationSentAt).toLocaleString() : 'Not sent'}</div>
        </div>
      </div>
    </div>
    
    <div class="detail-section">
      <h3>Policyholder Information</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Name</div>
          <div class="detail-value">${claim.policyholderName}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Mobile</div>
          <div class="detail-value">${claim.policyholderMobile}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Email</div>
          <div class="detail-value">${claim.policyholderEmail || 'N/A'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">VIN</div>
          <div class="detail-value">${claim.insurerProvidedVin || 'N/A'}</div>
        </div>
      </div>
    </div>
    
    ${decision ? `
      <div class="detail-section">
        <h3>Decision</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Outcome</div>
            <div class="detail-value"><strong>${formatDecision(decision.outcome)}</strong></div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Confidence</div>
            <div class="detail-value">
              ${confidence ? `${getConfidenceIcon(confidence)} ${(confidence * 100).toFixed(0)}%` : 'N/A'}
            </div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Decision Eligible</div>
            <div class="detail-value">${decision.decisionEligible ? 'Yes' : 'No'}</div>
          </div>
        </div>
        ${decision.justification ? `
          <div style="margin-top: 15px;">
            <div class="detail-label">Explanation</div>
            <div class="detail-value" style="margin-top: 8px; padding: 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a90d9;">
              ${decision.justification}
            </div>
          </div>
        ` : ''}
        ${decision.blockingReasons && decision.blockingReasons.length > 0 ? `
          <div style="margin-top: 15px;">
            <div class="detail-label">Blocking Reasons</div>
            <ul style="margin-top: 8px; padding-left: 20px;">
              ${decision.blockingReasons.map(reason => `<li>${reason}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    ` : ''}
    
    ${claim.photos && claim.photos.length > 0 ? `
      <div class="detail-section">
        <h3>Photos (${claim.photos.length})</h3>
        <div class="photo-grid">
          ${claim.photos.map(photo => `
            <div class="photo-item">
              <img src="${photo.file_path}" alt="${photo.photo_slot}" />
              <div class="photo-label">${formatPhotoSlot(photo.photo_slot)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '<p>No photos uploaded yet.</p>'}
    
    ${claim.manualReview ? `
      <div class="detail-section">
        <h3>Manual Review</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Trigger Source</div>
            <div class="detail-value">${claim.manualReview.triggerSource}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Priority</div>
            <div class="detail-value">${claim.manualReview.priority}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Status</div>
            <div class="detail-value">
              ${claim.manualReview.reviewCompletedAt ? 'Completed' : 'Pending'}
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;
}

// Format photo slot
function formatPhotoSlot(slot) {
  const map = {
    'front_vehicle': 'Front Vehicle',
    'inside_driver': 'Inside Driver',
    'inside_passenger': 'Inside Passenger',
    'logo_silkscreen': 'Logo/Silkscreen',
    'vin_cutout': 'VIN Cutout',
    'damage_1': 'Damage Photo 1',
    'damage_2': 'Damage Photo 2',
    'damage_3': 'Damage Photo 3',
  };
  return map[slot] || slot;
}

// Close claim detail modal
function closeClaimDetailModal() {
  document.getElementById('claimDetailModal').style.display = 'none';
}

// Open manual review modal
function openManualReviewModal(claimId) {
  document.getElementById('reviewClaimId').value = claimId;
  document.getElementById('reviewReason').value = '';
  document.getElementById('reviewPriority').value = 'normal';
  document.getElementById('manualReviewModal').style.display = 'flex';
}

// Close manual review modal
function closeManualReviewModal() {
  document.getElementById('manualReviewModal').style.display = 'none';
}

// Handle manual review submit
async function handleManualReviewSubmit(e) {
  e.preventDefault();
  
  const claimId = document.getElementById('reviewClaimId').value;
  const reason = document.getElementById('reviewReason').value;
  const priority = document.getElementById('reviewPriority').value;
  
  try {
    const response = await fetch(`/api/dashboard/claims/${claimId}/manual-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': accessCode,
      },
      body: JSON.stringify({ reason, priority }),
    });
    
    if (!response.ok) throw new Error('Failed to trigger manual review');
    
    const data = await response.json();
    
    alert(`Manual review triggered successfully!\nReview ID: ${data.reviewId}`);
    closeManualReviewModal();
    
    // Refresh claims
    loadClaims();
  } catch (error) {
    console.error('Failed to trigger manual review:', error);
    alert('Failed to trigger manual review. Please try again.');
  }
}

// Close modals when clicking outside
window.onclick = function(event) {
  const claimModal = document.getElementById('claimDetailModal');
  const reviewModal = document.getElementById('manualReviewModal');
  
  if (event.target === claimModal) {
    closeClaimDetailModal();
  }
  
  if (event.target === reviewModal) {
    closeManualReviewModal();
  }
};

// Resend notification for a claim
async function resendNotification(claimId) {
  if (!confirm('Resend the notification to the policyholder?')) return;
  
  try {
    const response = await fetch(`/api/dashboard/claims/${claimId}/resend-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': accessCode,
      },
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to resend notification');
    }
    
    const data = await response.json();
    alert(`Notification resent successfully!`);
    loadClaims();
  } catch (error) {
    console.error('Failed to resend notification:', error);
    alert('Failed to resend notification: ' + error.message);
  }
}
