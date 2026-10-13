// FeedbackHub Main Application Client Controller
// Mobile-First Architecture for All Screens (320px - 1440px+)

const app = (function () {
  'use strict';

  let token = localStorage.getItem('fh_token') || null;
  let currentUser = null;
  let currentBusiness = null;
  let locations = [];
  let forms = [];
  let feedbacks = [];
  let currentBuilderForm = null;

  // Chart instances
  let trendChartInstance = null;
  let sentimentChartInstance = null;
  let ratingDistChartInstance = null;

  // UI Elements
  const views = {
    landing: document.getElementById('view-landing'),
    login: document.getElementById('view-login'),
    register: document.getElementById('view-register'),
    dashboard: document.getElementById('view-dashboard'),
    inbox: document.getElementById('view-inbox'),
    builder: document.getElementById('view-builder'),
    analytics: document.getElementById('view-analytics'),
    qr: document.getElementById('view-qr'),
    locations: document.getElementById('view-locations'),
    settings: document.getElementById('view-settings'),
    admin: document.getElementById('view-admin')
  };

  const mobileDrawer = document.getElementById('mobileDrawer');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const pageTitle = document.getElementById('pageTitle');

  // --- API Helper ---
  async function api(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(endpoint, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Server request failed');
      err.status = res.status;
      err.statusCode = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // --- Mobile Drawer Controls ---
  function openMobileDrawer() {
    mobileDrawer.classList.add('active');
    drawerBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden'; // prevent background scrolling
  }

  function closeMobileDrawer() {
    mobileDrawer.classList.remove('active');
    drawerBackdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  // --- Toast Notifications ---
  function showToast(message, type = 'success') {
    const container = document.getElementById('appToastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
      <button style="background:none; border:none; color:#ffffff; font-size:1.1rem; cursor:pointer;" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 3500);
  }

  // --- Router ---
  function navigate(viewName) {
    closeMobileDrawer();

    // If unauthenticated and trying to access protected views, redirect cleanly to login
    if (!token && !['landing', 'login', 'register'].includes(viewName)) {
      window.location.hash = '#/login';
      viewName = 'login';
    }

    // Hide all views
    Object.keys(views).forEach(key => {
      if (views[key]) views[key].classList.add('hidden');
    });

    // Update active nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Show target view (fallback to login if unauthenticated, or landing)
    let targetView = views[viewName];
    if (!targetView) {
      targetView = token ? views.dashboard : views.landing;
      viewName = token ? 'dashboard' : 'landing';
    }

    if (targetView) {
      targetView.classList.remove('hidden');
    }

    // Update header & page specific logic
    const titles = {
      landing: 'Welcome to FeedbackHub',
      login: 'Sign In',
      register: 'Create Account',
      dashboard: 'Business Dashboard',
      inbox: 'Feedback Inbox',
      builder: 'Form Builder',
      analytics: 'Analytics & Insights',
      qr: 'QR Code Generator',
      locations: 'Store Locations',
      settings: 'Business Settings',
      admin: 'Super Admin Portal'
    };

    if (pageTitle) pageTitle.textContent = titles[viewName] || 'Dashboard';

    // View initialization hooks
    if (viewName === 'dashboard') loadDashboard();
    else if (viewName === 'inbox') loadInbox();
    else if (viewName === 'builder') initFormBuilder();
    else if (viewName === 'analytics') loadAnalytics();
    else if (viewName === 'qr') loadQrView();
    else if (viewName === 'locations') loadLocationsView();
    else if (viewName === 'settings') loadSettingsView();
    else if (viewName === 'admin') loadAdminView();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleRoute() {
    const rawHash = (window.location.hash || '').replace('#/', '').split('?')[0];
    const targetHash = rawHash || (token ? 'dashboard' : 'landing');
    navigate(targetHash);
  }

  // --- Outage Recovery Banner ---
  function showOutageBanner(message) {
    let banner = document.getElementById('dbOutageBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'dbOutageBanner';
      banner.style.cssText = 'background:#fef2f2; border:1px solid #f87171; color:#991b1b; padding:12px 16px; border-radius:8px; margin:16px auto; max-width:600px; display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:0.9rem;';
      banner.innerHTML = `
        <div style="flex:1;">
          <strong>Database Connection Unavailable</strong>
          <div style="font-size:0.8rem; color:#b91c1c; margin-top:2px;">${escapeHtml(message || 'The backend cannot connect to MongoDB. Please ensure MONGODB_URI is set correctly in backend/.env.')}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btnRetryOutage" style="white-space:nowrap;">Retry 🔄</button>
      `;
      const mainContent = document.getElementById('mainContent');
      if (mainContent) mainContent.prepend(banner);
      document.getElementById('btnRetryOutage')?.addEventListener('click', async () => {
        banner.remove();
        showToast('Retrying connection...', 'info');
        await initSession();
      });
    }
  }

  // --- Demo Mode Status Check ---
  async function checkDemoMode() {
    try {
      const res = await api('/api/auth/demo-status');
      if (res && res.demoEnabled === false) {
        // Hide demo switch buttons if disabled
        document.querySelectorAll('.demo-switch-container, [data-demo-control]').forEach(el => {
          el.style.display = 'none';
        });
      }
    } catch (e) {
      // Non-fatal
    }
  }

  // --- Auth & Session ---
  async function initSession() {
    await checkDemoMode();

    // 1. Unauthenticated Visitor Flow: Never auto-login or leave blank
    if (!token) {
      const currentHash = window.location.hash;
      // If opening a protected route without token, redirect to login
      if (currentHash && !['#/login', '#/register', '#/landing', ''].includes(currentHash)) {
        window.location.hash = '#/login';
      }
      handleRoute();
      return;
    }

    // 2. Existing Token Flow: Validate session with /api/auth/me
    try {
      const data = await api('/api/auth/me');
      currentUser = data.user;
      currentBusiness = data.business;
      updateUserUI();
      await fetchCommonData();
      handleRoute();
    } catch (err) {
      const isOutage = err.status === 503 || (err.message && (
        err.message.includes('Database connection unavailable') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError')
      ));

      if (isOutage) {
        console.warn('[Session] Temporary database outage detected:', err.message);
        // Preserve token! Show recovery banner so user can retry without losing session
        showOutageBanner(err.message);
        handleRoute();
      } else {
        console.warn('[Session] Token expired or invalid, logging out:', err);
        logout(false);
      }
    }
  }

  async function switchDemo(role) {
    if (role === 'superadmin') {
      showToast('Super Admin access requires manual login with authorized credentials (admin@feedbackhub.com). 1-click elevation is disabled for security.', 'error');
      window.location.hash = '#/login';
      handleRoute();
      return;
    }

    try {
      const data = await api('/api/auth/switch-demo', {
        method: 'POST',
        body: JSON.stringify({ role })
      });

      token = data.token;
      localStorage.setItem('fh_token', token);
      currentUser = data.user;
      currentBusiness = data.business;

      const roleLabels = {
        owner: 'Business Owner (Sarah)',
        manager: 'Location Manager (Marcus)',
        college: 'College Admin (Dr. Sharma)'
      };
      showToast(`Switched to: ${roleLabels[role] || role}`, 'success');
      updateUserUI();
      await fetchCommonData();

      window.location.hash = '#/dashboard';
      handleRoute();
    } catch (err) {
      showToast(err.message, 'error');
      // If demo switch fails, redirect to login screen so UI is never blank
      if (!token) {
        window.location.hash = '#/login';
        handleRoute();
      }
    }
  }

  function updateUserUI() {
    if (!currentUser) return;

    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const drawerBizName = document.getElementById('drawerBizName');
    const desktopBizName = document.getElementById('desktopBizName');
    const mobileAdminItem = document.getElementById('mobileAdminNavItem');
    const desktopAdminItem = document.getElementById('desktopAdminNavItem');

    if (userAvatar) userAvatar.textContent = currentUser.avatar || '👤';
    if (userName) userName.textContent = currentUser.name.split(' ')[0];

    const bizDisplayName = currentBusiness ? currentBusiness.name : (currentUser.role === 'superadmin' ? 'Super Admin Mode' : 'My Business');
    if (drawerBizName) drawerBizName.textContent = bizDisplayName;
    if (desktopBizName) desktopBizName.textContent = bizDisplayName;

    const isSuperAdmin = currentUser.role === 'superadmin';
    if (mobileAdminItem) mobileAdminItem.classList.toggle('hidden', !isSuperAdmin);
    if (desktopAdminItem) desktopAdminItem.classList.toggle('hidden', !isSuperAdmin);

    const publicLink = document.getElementById('headerPublicFormLink');
    if (publicLink) publicLink.style.display = 'inline-flex';
  }

  function logout(showNotification = true) {
    token = null;
    currentUser = null;
    currentBusiness = null;
    localStorage.removeItem('fh_token');
    if (showNotification) {
      showToast('Logged out successfully', 'info');
    }
    window.location.hash = '#/login';
    handleRoute();
  }

  async function fetchCommonData() {
    try {
      const [locRes, formsRes] = await Promise.all([
        api('/api/locations'),
        api('/api/forms')
      ]);
      locations = locRes.locations || [];
      forms = formsRes.forms || [];
      populateLocationDropdowns();
    } catch (err) {
      console.error('Error fetching common data:', err);
    }
  }

  function populateLocationDropdowns() {
    const dashSelect = document.getElementById('dashLocationSelect');
    const inboxSelect = document.getElementById('inboxLocationFilter');
    const analyticsSelect = document.getElementById('analyticsLocationSelect');
    const builderSelect = document.getElementById('builderLocation');

    const optionsHtml = '<option value="all">All Locations</option>' +
      locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');

    if (dashSelect) dashSelect.innerHTML = optionsHtml;
    if (inboxSelect) inboxSelect.innerHTML = optionsHtml;
    if (analyticsSelect) analyticsSelect.innerHTML = optionsHtml;

    if (builderSelect) {
      builderSelect.innerHTML = '<option value="">All Locations (General)</option>' +
        locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
    }
  }

  // --- Dashboard ---
  async function loadDashboard() {
    const locId = document.getElementById('dashLocationSelect')?.value || 'all';
    const timeRange = document.getElementById('dashTimeSelect')?.value || 'all';

    try {
      const [analyticsData, fbRes] = await Promise.all([
        api(`/api/analytics/dashboard?locationId=${locId}&timeRange=${timeRange}`),
        api(`/api/feedback?locationId=${locId}`)
      ]);

      const s = analyticsData.summary;
      document.getElementById('statTotalResponses').textContent = s.total;
      const avgNum = parseFloat(s.avgRating);
      const hasRating = s.avgRating !== 'N/A' && !isNaN(avgNum);
      document.getElementById('statAvgRating').textContent = hasRating ? s.avgRating : 'N/A';
      if (hasRating) {
        const rounded = Math.max(0, Math.min(5, Math.round(avgNum)));
        document.getElementById('statRatingStars').textContent = '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
      } else {
        document.getElementById('statRatingStars').textContent = 'No rating data';
      }

      if (s.npsScore !== 'N/A' && typeof s.npsScore === 'number') {
        document.getElementById('statNpsScore').textContent = (s.npsScore >= 0 ? '+' : '') + s.npsScore;
      } else {
        document.getElementById('statNpsScore').textContent = 'N/A';
      }
      document.getElementById('statPendingComplaints').textContent = s.pendingComplaints;
      document.getElementById('statResolutionRate').textContent = `${s.resolutionRate}% Resolved`;

      renderDashboardCharts(analyticsData.timeline, analyticsData.sentimentCounts);
      renderRecentFeedbacks(fbRes.feedbacks.slice(0, 5));
    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  }

  function renderDashboardCharts(timeline, sentimentCounts) {
    // 1. Trend Chart
    const trendCtx = document.getElementById('trendChartCanvas');
    if (trendCtx) {
      if (trendChartInstance) trendChartInstance.destroy();

      trendChartInstance = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: timeline.map(t => t.date),
          datasets: [
            {
              label: 'Responses Count',
              data: timeline.map(t => t.count),
              borderColor: '#4f46e5',
              backgroundColor: 'rgba(79, 70, 229, 0.1)',
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              yAxisID: 'y'
            },
            {
              label: 'Avg Rating (★)',
              data: timeline.map(t => t.avgRating),
              borderColor: '#f59e0b',
              backgroundColor: 'transparent',
              borderWidth: 2,
              borderDash: [4, 4],
              tension: 0.2,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { stepSize: 1 } },
            y1: { min: 0, max: 5, position: 'right', grid: { drawOnChartArea: false }, ticks: { stepSize: 1 } }
          }
        }
      });
    }

    // 2. Sentiment Doughnut
    const sentCtx = document.getElementById('sentimentChartCanvas');
    if (sentCtx) {
      if (sentimentChartInstance) sentimentChartInstance.destroy();

      sentimentChartInstance = new Chart(sentCtx, {
        type: 'doughnut',
        data: {
          labels: ['Positive (4-5★)', 'Neutral (3★)', 'Negative (1-2★)'],
          datasets: [
            {
              data: [sentimentCounts.positive, sentimentCounts.neutral, sentimentCounts.negative],
              backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
              borderWidth: 2,
              borderColor: '#ffffff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
          }
        }
      });
    }
  }

  function renderRecentFeedbacks(list) {
    const container = document.getElementById('dashRecentFeedbacks');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm text-center" style="padding: 20px;">No feedback responses received yet.</p>';
      return;
    }

    container.innerHTML = list.map(fb => createFeedbackCardHtml(fb)).join('');
  }

  // --- Inbox (Feedback Management) ---
  async function loadInbox() {
    try {
      const q = buildInboxFilterQuery();
      const res = await api(`/api/feedback${q}`);
      feedbacks = res.feedbacks || [];
      renderInboxFeedbacks(feedbacks);
    } catch (err) {
      console.error('Error loading inbox:', err);
    }
  }

  function buildInboxFilterQuery() {
    const search = document.getElementById('inboxSearchInput')?.value.trim() || '';
    const rating = document.getElementById('inboxRatingFilter')?.value || 'all';
    const status = document.getElementById('inboxStatusFilter')?.value || 'all';
    const priority = document.getElementById('inboxPriorityFilter')?.value || 'all';
    const loc = document.getElementById('inboxLocationFilter')?.value || 'all';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (rating !== 'all') params.append('rating', rating);
    if (status !== 'all') params.append('status', status);
    if (priority !== 'all') params.append('priority', priority);
    if (loc !== 'all') params.append('locationId', loc);

    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  let filterDebounce = null;
  function filterInbox() {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(() => {
      loadInbox();
    }, 250);
  }

  async function exportCsv() {
    try {
      showToast('Preparing CSV export...', 'info');
      const res = await fetch('/api/feedback/export/csv', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to export feedback CSV');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedbackhub-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast('CSV export downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderInboxFeedbacks(list) {
    const countText = document.getElementById('inboxCountText');
    if (countText) countText.textContent = `Showing ${list.length} feedback response${list.length === 1 ? '' : 's'}`;

    // 1. Mobile Cards (< 900px)
    const cardsContainer = document.getElementById('inboxCardsList');
    if (cardsContainer) {
      if (list.length === 0) {
        cardsContainer.innerHTML = '<div class="card text-center text-muted" style="padding: 30px;">No feedback found matching the selected filters.</div>';
      } else {
        cardsContainer.innerHTML = list.map(fb => createFeedbackCardHtml(fb)).join('');
      }
    }

    // 2. Desktop Table (>= 900px)
    const tableBody = document.getElementById('inboxTableBody');
    if (tableBody) {
      if (list.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding: 30px;">No feedback found matching filters.</td></tr>';
      } else {
        tableBody.innerHTML = list.map(fb => `
          <tr>
            <td>
              <div style="font-weight:700; color:#f59e0b;">
                ${(typeof fb.rating === 'number' && !isNaN(fb.rating))
                  ? `${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)} <span style="color:var(--neutral-700); font-size:0.85rem; margin-left:4px;">(${fb.rating})</span>`
                  : (typeof fb.nps === 'number' ? `<span style="color:var(--primary); font-size:0.85rem;">NPS: ${fb.nps}/10</span>` : '<span style="color:var(--neutral-400); font-size:0.85rem;">N/A</span>')
                }
              </div>
            </td>
            <td>
              <div style="font-weight:600;">${escapeHtml(fb.customerName || 'Anonymous')}</div>
              <div style="font-size:0.75rem; color:var(--neutral-500);">${escapeHtml(fb.customerEmail || 'No email')}</div>
            </td>
            <td>
              <div style="max-width: 260px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                ${escapeHtml(fb.comments || 'No comment text provided')}
              </div>
            </td>
            <td><span class="badge badge-${fb.status}">${fb.status.replace('_', ' ')}</span></td>
            <td><span class="badge badge-${fb.priority}">${fb.priority}</span></td>
            <td><span style="font-size:0.85rem;">${escapeHtml(fb.locationName || 'General')}</span></td>
            <td><span style="font-size:0.8rem; color:var(--neutral-500);">${new Date(fb.createdAt).toLocaleDateString()}</span></td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" onclick="app.openFeedbackModal('${fb.id}')">
                Manage
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  function createFeedbackCardHtml(fb) {
    const stars = (typeof fb.rating === 'number' && !isNaN(fb.rating))
      ? `${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)}`
      : (typeof fb.nps === 'number' ? `NPS: ${fb.nps}/10` : 'No Star Rating');
    const dateFormatted = new Date(fb.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div class="feedback-card" id="card-${fb.id}">
        <div class="feedback-card-header">
          <div>
            <div style="color: #f59e0b; font-size: 1.15rem; font-weight: 700;">${stars}</div>
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--neutral-900); margin-top: 2px;">
              ${escapeHtml(fb.customerName || 'Anonymous Customer')}
            </div>
          </div>
          <div class="feedback-card-badges">
            <span class="badge badge-${fb.sentiment}">${fb.sentiment}</span>
            <span class="badge badge-${fb.status}">${fb.status.replace('_', ' ')}</span>
            <span class="badge badge-${fb.priority}">${fb.priority}</span>
          </div>
        </div>

        <div class="feedback-card-body">
          ${fb.comments ? `"${escapeHtml(fb.comments)}"` : '<em style="color:var(--neutral-400);">No written comment text</em>'}
        </div>

        <div class="feedback-card-footer">
          <div>
            <span>📍 ${escapeHtml(fb.locationName || 'Main Store')}</span> • <span>${dateFormatted}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="app.openFeedbackModal('${fb.id}')">
            View &amp; Resolve →
          </button>
        </div>
      </div>
    `;
  }

  // --- Feedback Detail & Resolution Modal ---
  async function openFeedbackModal(id) {
    try {
      const res = await api(`/api/feedback/${id}`);
      const fb = res.feedback;
      const modal = document.getElementById('feedbackDetailModal');
      const modalBody = document.getElementById('modalFbBody');

      const dateStr = new Date(fb.createdAt).toLocaleString();
      const stars = (typeof fb.rating === 'number' && !isNaN(fb.rating))
        ? `${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)}`
        : (typeof fb.nps === 'number' ? `NPS Score: ${fb.nps}/10` : 'No Star Rating');

      // Render Modal Content
      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Top summary -->
          <div style="background-color: var(--neutral-50); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--neutral-200);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="color:#f59e0b; font-size: 1.4rem; font-weight: 700;">${stars}</span>
              <div style="display: flex; gap: 6px;">
                <span class="badge badge-${fb.sentiment}">${fb.sentiment}</span>
                <span class="badge badge-${fb.priority}">${fb.priority}</span>
              </div>
            </div>
            <div style="font-weight: 600; font-size: 1rem;">${escapeHtml(fb.customerName || 'Anonymous Customer')}</div>
            <div style="font-size: 0.85rem; color: var(--neutral-600); margin-top: 4px;">
              📧 ${escapeHtml(fb.customerEmail || 'No email')} ${fb.customerPhone ? `• 📞 ${escapeHtml(fb.customerPhone)}` : ''}
            </div>
            <div style="font-size: 0.75rem; color: var(--neutral-400); margin-top: 6px;">
              Submitted on ${dateStr} • via ${escapeHtml(fb.source || 'QR Code')}
            </div>
          </div>

          <!-- Comment text -->
          <div>
            <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--neutral-700); margin-bottom: 6px;">Customer Comment</h4>
            <div style="background-color: #ffffff; border: 1px solid var(--neutral-200); padding: 12px; border-radius: var(--radius-md); font-size: 0.95rem; line-height: 1.5;">
              ${escapeHtml(fb.comments || 'No comment provided.')}
            </div>
          </div>

          <!-- Dynamic Question Answers -->
          ${fb.answers && Object.keys(fb.answers).length > 0 ? `
            <div>
              <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--neutral-700); margin-bottom: 6px;">Question Responses</h4>
              <div style="background-color: var(--neutral-50); border: 1px solid var(--neutral-200); padding: 12px; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 8px; font-size: 0.88rem;">
                ${Object.entries(fb.answers).map(([key, val]) => `
                  <div>
                    <span style="font-weight: 600; color: var(--neutral-700);">${escapeHtml(key)}:</span>
                    <span style="color: var(--neutral-900); margin-left: 6px;">${escapeHtml(String(val))}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Quick Actions: Status & Priority & Assignment -->
          <div style="display: grid; grid-template-columns: 1fr; gap: 12px; border-top: 1px solid var(--neutral-200); padding-top: 14px;">
            <div class="form-group">
              <label class="form-label" style="font-size: 0.85rem;">Workflow Status</label>
              <select id="modalStatusSelect" class="form-select" onchange="app.updateFeedbackStatus('${fb.id}', this.value)">
                <option value="new" ${fb.status === 'new' ? 'selected' : ''}>🔵 New</option>
                <option value="in_review" ${fb.status === 'in_review' ? 'selected' : ''}>🟠 In Review</option>
                <option value="resolved" ${fb.status === 'resolved' ? 'selected' : ''}>🟢 Resolved</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size: 0.85rem;">Priority Level</label>
              <select id="modalPrioritySelect" class="form-select" onchange="app.updateFeedbackPriority('${fb.id}', this.value)">
                <option value="low" ${fb.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${fb.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="urgent" ${fb.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                <option value="critical" ${fb.priority === 'critical' ? 'selected' : ''}>Critical</option>
              </select>
            </div>
          </div>

          <!-- Internal Notes Thread -->
          <div style="border-top: 1px solid var(--neutral-200); padding-top: 14px;">
            <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--neutral-700); margin-bottom: 8px;">Internal Team Notes</h4>
            <div id="modalNotesContainer" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; max-height: 180px; overflow-y: auto;">
              ${(fb.internalNotes || []).length > 0 ? fb.internalNotes.map(n => `
                <div style="background-color: var(--neutral-100); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.85rem;">
                  <div style="display: flex; justify-content: space-between; font-weight: 600; color: var(--neutral-700); margin-bottom: 2px;">
                    <span>${escapeHtml(n.author)}</span>
                    <span style="font-size: 0.75rem; color: var(--neutral-400);">${new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div>${escapeHtml(n.text)}</div>
                </div>
              `).join('') : '<p class="text-muted text-sm">No internal notes yet.</p>'}
            </div>

            <!-- Add Note Form -->
            <div style="display: flex; gap: 8px;">
              <input type="text" id="newNoteInput" class="form-input" placeholder="Add an internal note..." style="min-height: 40px; font-size: 0.88rem;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="app.addInternalNote('${fb.id}')">Add</button>
            </div>
          </div>

          <!-- Complaint Resolution Section -->
          ${fb.status !== 'resolved' ? `
            <div style="border-top: 1px solid var(--neutral-200); padding-top: 14px; background-color: var(--success-light); padding: 14px; border-radius: var(--radius-md);">
              <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--success-text); margin-bottom: 6px;">Mark Complaint as Resolved</h4>
              <p class="text-sm" style="color: var(--success-text); margin-bottom: 8px;">Document follow-up action taken (e.g. voucher sent, apology call):</p>
              <textarea id="resolutionNoteInput" class="form-textarea" rows="2" placeholder="e.g. Called customer, replaced drink, issue resolved."></textarea>
              <button type="button" class="btn btn-success btn-block btn-sm mt-4" onclick="app.resolveComplaint('${fb.id}')">
                ✓ Mark as Resolved
              </button>
            </div>
          ` : `
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: var(--radius-md); font-size: 0.85rem; color: #166534;">
              <strong>✓ Resolved</strong> by ${escapeHtml(fb.resolution?.resolvedBy || 'Team')} on ${new Date(fb.resolution?.resolvedAt || fb.updatedAt).toLocaleDateString()}
              ${fb.resolution?.resolutionNote ? `<div style="margin-top:4px;"><em>"${escapeHtml(fb.resolution.resolutionNote)}"</em></div>` : ''}
            </div>
          `}
        </div>
      `;

      modal.classList.add('active');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function closeFeedbackModal() {
    document.getElementById('feedbackDetailModal')?.classList.remove('active');
  }

  async function updateFeedbackStatus(id, status) {
    try {
      await api(`/api/feedback/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      showToast(`Status updated to ${status}`);
      loadInbox();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function updateFeedbackPriority(id, priority) {
    try {
      await api(`/api/feedback/${id}/priority`, {
        method: 'PATCH',
        body: JSON.stringify({ priority })
      });
      showToast(`Priority updated to ${priority}`);
      loadInbox();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function addInternalNote(id) {
    const input = document.getElementById('newNoteInput');
    const text = input?.value.trim();
    if (!text) return;

    try {
      await api(`/api/feedback/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      input.value = '';
      showToast('Internal note saved');
      openFeedbackModal(id); // reload modal content
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function resolveComplaint(id) {
    const note = document.getElementById('resolutionNoteInput')?.value.trim();
    try {
      await api(`/api/feedback/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNote: note })
      });
      showToast('Feedback marked as resolved!', 'success');
      closeFeedbackModal();
      loadInbox();
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Form Builder ---
  async function initFormBuilder() {
    try {
      const res = await api('/api/forms');
      forms = res.forms || [];

      const selector = document.getElementById('builderFormSelector');
      if (selector) {
        selector.innerHTML = forms.map(f => `
          <option value="${f.id}">${escapeHtml(f.title)} (${escapeHtml(f.slug)})</option>
        `).join('');

        if (forms.length > 0) {
          loadBuilderForm(forms[0].id);
        }
      }
    } catch (err) {
      console.error('Error init form builder:', err);
    }
  }

  async function loadBuilderForm(formId) {
    try {
      const res = await api(`/api/forms/${formId}`);
      currentBuilderForm = res.form;

      document.getElementById('builderTitle').value = currentBuilderForm.title || '';
      document.getElementById('builderDesc').value = currentBuilderForm.description || '';
      document.getElementById('builderLocation').value = currentBuilderForm.locationId || '';
      document.getElementById('builderStatus').value = currentBuilderForm.status || 'published';
      document.getElementById('builderGoogleUrl').value = currentBuilderForm.googleReviewUrl || '';

      const cfg = currentBuilderForm.collegeFieldsConfig || {};
      const setCheckbox = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
      };
      setCheckbox('cfgDept', cfg.departmentEnabled);
      setCheckbox('cfgCourse', cfg.courseEnabled);
      setCheckbox('cfgAcadYear', cfg.academicYearEnabled);
      setCheckbox('cfgYearOfStudy', cfg.yearOfStudyEnabled);
      setCheckbox('cfgSemester', cfg.semesterEnabled);
      setCheckbox('cfgSection', cfg.sectionEnabled);
      setCheckbox('cfgFaculty', cfg.facultyEnabled);
      setCheckbox('cfgSubject', cfg.subjectEnabled);
      setCheckbox('cfgCategory', cfg.categoryEnabled);
      setCheckbox('cfgAllowAnonymous', currentBuilderForm.allowAnonymous !== false);

      renderBuilderQuestions();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function applySelectedTemplate() {
    const templateKey = document.getElementById('builderTemplateSelect')?.value;
    if (!templateKey) {
      showToast('Please select a template to apply', 'info');
      return;
    }

    try {
      showToast('Fetching starter template...', 'info');
      const res = await api('/api/forms/templates');
      const templates = res.templates || [];
      const chosen = templates.find(t => t.type === templateKey);

      if (!chosen) {
        showToast('Template not found', 'error');
        return;
      }

      if (!currentBuilderForm) {
        currentBuilderForm = {
          title: chosen.name,
          description: chosen.description,
          status: 'published',
          questions: []
        };
      }

      currentBuilderForm.title = chosen.name;
      currentBuilderForm.description = chosen.description;
      currentBuilderForm.collegeFieldsConfig = chosen.collegeFieldsConfig || {};
      currentBuilderForm.questions = JSON.parse(JSON.stringify(chosen.questions || []));

      document.getElementById('builderTitle').value = currentBuilderForm.title;
      document.getElementById('builderDesc').value = currentBuilderForm.description;

      const cfg = currentBuilderForm.collegeFieldsConfig;
      const setCheckbox = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
      };
      setCheckbox('cfgDept', cfg.departmentEnabled);
      setCheckbox('cfgCourse', cfg.courseEnabled);
      setCheckbox('cfgAcadYear', cfg.academicYearEnabled);
      setCheckbox('cfgYearOfStudy', cfg.yearOfStudyEnabled);
      setCheckbox('cfgSemester', cfg.semesterEnabled);
      setCheckbox('cfgSection', cfg.sectionEnabled);
      setCheckbox('cfgFaculty', cfg.facultyEnabled);
      setCheckbox('cfgSubject', cfg.subjectEnabled);
      setCheckbox('cfgCategory', cfg.categoryEnabled);
      setCheckbox('cfgAllowAnonymous', true);

      renderBuilderQuestions();
      showToast(`Applied "${chosen.name}" template successfully!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderBuilderQuestions() {
    const container = document.getElementById('builderQuestionsContainer');
    if (!container || !currentBuilderForm) return;

    const questions = currentBuilderForm.questions || [];
    container.innerHTML = questions.map((q, index) => {
      const isFirst = index === 0;
      const isLast = index === questions.length - 1;
      const hasConditional = Boolean(q.conditional && q.conditional.dependsOn);
      const otherQuestions = questions.filter((_, i) => i !== index);

      return `
        <div class="builder-question-card" id="q-card-${index}">
          <div class="builder-question-header">
            <span style="font-weight: 700; font-size: 0.95rem; color: var(--primary);">
              Question ${index + 1} (${q.type})
            </span>
            <div class="builder-actions-group">
              <button type="button" class="reorder-btn" title="Move Up" aria-label="Move question up" onclick="app.moveQuestion(${index}, -1)" ${isFirst ? 'disabled' : ''}>
                ▲
              </button>
              <button type="button" class="reorder-btn" title="Move Down" aria-label="Move question down" onclick="app.moveQuestion(${index}, 1)" ${isLast ? 'disabled' : ''}>
                ▼
              </button>
              <button type="button" class="icon-btn" style="color:var(--danger); border-color:#fecaca;" title="Delete Question" aria-label="Delete question" onclick="app.deleteQuestion(${index})">
                🗑️
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label" style="font-size: 0.85rem;">Question Prompt / Label</label>
              <input type="text" class="form-input" value="${escapeHtml(q.text)}" oninput="app.updateQuestionField(${index}, 'text', this.value)">
            </div>

            <div style="display: grid; grid-template-columns: 1fr; gap: 10px;">
              <div class="form-group">
                <label class="form-label" style="font-size: 0.85rem;">Input Control Type</label>
                <select class="form-select" onchange="app.updateQuestionField(${index}, 'type', this.value)">
                  <option value="rating" ${q.type === 'rating' ? 'selected' : ''}>⭐ 5-Star Rating Control</option>
                  <option value="nps" ${q.type === 'nps' ? 'selected' : ''}>📈 Net Promoter Score (0-10 Scale)</option>
                  <option value="choice" ${q.type === 'choice' ? 'selected' : ''}>🔘 Multiple Choice (Radio)</option>
                  <option value="select" ${q.type === 'select' ? 'selected' : ''}>📋 Dropdown Select</option>
                  <option value="checkbox" ${q.type === 'checkbox' ? 'selected' : ''}>☑️ Multiple Choice (Checkboxes)</option>
                  <option value="yesno" ${q.type === 'yesno' ? 'selected' : ''}>👍 Yes / No Toggle</option>
                  <option value="text" ${q.type === 'text' ? 'selected' : ''}>📝 Short Text Box</option>
                  <option value="multiline" ${q.type === 'multiline' ? 'selected' : ''}>📄 Long Multiline Text</option>
                  <option value="email" ${q.type === 'email' ? 'selected' : ''}>✉️ Email Address</option>
                  <option value="phone" ${q.type === 'phone' ? 'selected' : ''}>📞 Phone Number</option>
                  <option value="number" ${q.type === 'number' ? 'selected' : ''}>🔢 Numeric Value</option>
                  <option value="date" ${q.type === 'date' ? 'selected' : ''}>📅 Date Picker</option>
                </select>
              </div>

              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <input type="checkbox" id="req_${index}" style="width: 20px; height: 20px;" ${q.required ? 'checked' : ''} onchange="app.updateQuestionField(${index}, 'required', this.checked)">
                <label for="req_${index}" class="form-label" style="margin: 0; cursor: pointer;">Mandatory / Required question</label>
              </div>
            </div>

            ${['choice', 'select', 'checkbox'].includes(q.type) ? `
              <div style="background-color: var(--neutral-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--neutral-200);">
                <label class="form-label" style="font-size: 0.85rem;">Option List:</label>
                <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">
                  ${(q.options || []).map((opt, optIndex) => `
                    <div style="display: flex; gap: 6px;">
                      <input type="text" class="form-input" value="${escapeHtml(opt)}" style="min-height: 36px; font-size: 0.88rem;" oninput="app.updateQuestionChoice(${index}, ${optIndex}, this.value)">
                      <button type="button" class="btn btn-secondary btn-sm" onclick="app.removeQuestionChoice(${index}, ${optIndex})">✕</button>
                    </div>
                  `).join('')}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="app.addQuestionChoice(${index})">➕ Add Choice Option</button>
              </div>
            ` : ''}

            <!-- Conditional Display Logic -->
            <div style="background-color: var(--neutral-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--neutral-200);">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; cursor: pointer; font-weight: 600;">
                <input type="checkbox" id="cond_toggle_${index}" ${hasConditional ? 'checked' : ''} onchange="app.updateQuestionConditional(${index}, 'enabled', this.checked)">
                Show this question conditionally based on another answer
              </label>

              ${hasConditional ? `
                <div style="display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 10px;">
                  <div class="form-group">
                    <label class="form-label" style="font-size: 0.8rem;">Depends on Question:</label>
                    <select class="form-select" onchange="app.updateQuestionConditional(${index}, 'dependsOn', this.value)">
                      ${otherQuestions.map(oq => `
                        <option value="${oq.id}" ${q.conditional && q.conditional.dependsOn === oq.id ? 'selected' : ''}>
                          ${escapeHtml(oq.text.slice(0, 45))} (${oq.id})
                        </option>
                      `).join('')}
                    </select>
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="form-group">
                      <label class="form-label" style="font-size: 0.8rem;">Operator:</label>
                      <select class="form-select" onchange="app.updateQuestionConditional(${index}, 'operator', this.value)">
                        <option value="equals" ${q.conditional && q.conditional.operator === 'equals' ? 'selected' : ''}>Equals (=)</option>
                        <option value="not_equals" ${q.conditional && q.conditional.operator === 'not_equals' ? 'selected' : ''}>Not Equals (!=)</option>
                        <option value="greater_than" ${q.conditional && q.conditional.operator === 'greater_than' ? 'selected' : ''}>Greater Than (&gt;)</option>
                        <option value="less_than" ${q.conditional && q.conditional.operator === 'less_than' ? 'selected' : ''}>Less Than (&lt;)</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label class="form-label" style="font-size: 0.8rem;">Target Answer Value:</label>
                      <input type="text" class="form-input" value="${escapeHtml(q.conditional ? q.conditional.value : '')}" placeholder="e.g. Yes or 1 or Option A" oninput="app.updateQuestionConditional(${index}, 'value', this.value)">
                    </div>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function moveQuestion(index, direction) {
    if (!currentBuilderForm || !currentBuilderForm.questions) return;
    const qList = currentBuilderForm.questions;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= qList.length) return;

    const temp = qList[index];
    qList[index] = qList[targetIdx];
    qList[targetIdx] = temp;

    renderBuilderQuestions();
    showToast('Question order adjusted');
  }

  function updateQuestionField(index, field, value) {
    if (!currentBuilderForm || !currentBuilderForm.questions[index]) return;
    currentBuilderForm.questions[index][field] = value;
    if (['choice', 'select', 'checkbox'].includes(value) && !currentBuilderForm.questions[index].options) {
      currentBuilderForm.questions[index].options = ['Option A', 'Option B'];
      renderBuilderQuestions();
    }
  }

  function updateQuestionConditional(index, field, value) {
    if (!currentBuilderForm || !currentBuilderForm.questions[index]) return;
    if (field === 'enabled') {
      if (!value) {
        delete currentBuilderForm.questions[index].conditional;
      } else {
        const otherQuestions = currentBuilderForm.questions.filter((_, i) => i !== index);
        currentBuilderForm.questions[index].conditional = {
          dependsOn: otherQuestions.length > 0 ? otherQuestions[0].id : '',
          operator: 'equals',
          value: ''
        };
      }
      renderBuilderQuestions();
      return;
    }
    if (!currentBuilderForm.questions[index].conditional) {
      currentBuilderForm.questions[index].conditional = {
        dependsOn: '',
        operator: 'equals',
        value: ''
      };
    }
    currentBuilderForm.questions[index].conditional[field] = value;
  }

  function addQuestionChoice(qIndex) {
    if (!currentBuilderForm.questions[qIndex].options) {
      currentBuilderForm.questions[qIndex].options = [];
    }
    currentBuilderForm.questions[qIndex].options.push(`New Option ${currentBuilderForm.questions[qIndex].options.length + 1}`);
    renderBuilderQuestions();
  }

  function removeQuestionChoice(qIndex, optIndex) {
    currentBuilderForm.questions[qIndex].options.splice(optIndex, 1);
    renderBuilderQuestions();
  }

  function updateQuestionChoice(qIndex, optIndex, val) {
    currentBuilderForm.questions[qIndex].options[optIndex] = val;
  }

  function deleteQuestion(index) {
    if (!currentBuilderForm) return;
    if (currentBuilderForm.questions.length <= 1) {
      showToast('A form must have at least one question', 'error');
      return;
    }
    currentBuilderForm.questions.splice(index, 1);
    renderBuilderQuestions();
    showToast('Question removed');
  }

  function addBuilderQuestion() {
    if (!currentBuilderForm) return;
    if (!currentBuilderForm.questions) currentBuilderForm.questions = [];

    currentBuilderForm.questions.push({
      id: 'q_' + Date.now(),
      type: 'rating',
      text: 'How would you rate this experience overall?',
      required: true
    });

    renderBuilderQuestions();
    showToast('Added new question card');

    setTimeout(() => {
      const cards = document.querySelectorAll('.builder-question-card');
      if (cards.length > 0) {
        cards[cards.length - 1].scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  }

  async function saveCurrentForm() {
    if (!currentBuilderForm) return;

    const collegeFieldsConfig = {
      departmentEnabled: document.getElementById('cfgDept')?.checked || false,
      departmentRequired: document.getElementById('cfgDept')?.checked || false,
      courseEnabled: document.getElementById('cfgCourse')?.checked || false,
      courseRequired: document.getElementById('cfgCourse')?.checked || false,
      academicYearEnabled: document.getElementById('cfgAcadYear')?.checked || false,
      academicYearRequired: false,
      yearOfStudyEnabled: document.getElementById('cfgYearOfStudy')?.checked || false,
      yearOfStudyRequired: false,
      semesterEnabled: document.getElementById('cfgSemester')?.checked || false,
      semesterRequired: false,
      sectionEnabled: document.getElementById('cfgSection')?.checked || false,
      sectionRequired: false,
      facultyEnabled: document.getElementById('cfgFaculty')?.checked || false,
      facultyRequired: document.getElementById('cfgFaculty')?.checked || false,
      subjectEnabled: document.getElementById('cfgSubject')?.checked || false,
      subjectRequired: document.getElementById('cfgSubject')?.checked || false,
      categoryEnabled: document.getElementById('cfgCategory')?.checked || false,
      categoryRequired: false
    };

    const targetStatus = document.getElementById('builderStatus')?.value;
    const payload = {
      title: document.getElementById('builderTitle').value.trim(),
      description: document.getElementById('builderDesc').value.trim(),
      locationId: document.getElementById('builderLocation').value || null,
      googleReviewUrl: document.getElementById('builderGoogleUrl').value.trim(),
      collegeFieldsConfig,
      allowAnonymous: document.getElementById('cfgAllowAnonymous')?.checked !== false,
      questions: currentBuilderForm.questions
    };

    if (!payload.title) {
      showToast('Form title is required', 'error');
      return;
    }

    // Validate questions: non-blank labels and non-blank choices
    for (let i = 0; i < (payload.questions || []).length; i++) {
      const q = payload.questions[i];
      if (!q.text || !q.text.trim()) {
        showToast(`Question #${i + 1} cannot have an empty label`, 'error');
        return;
      }
      if (['choice', 'select', 'checkbox'].includes(q.type)) {
        const validOptions = (q.options || []).filter(o => o && o.trim());
        if (validOptions.length === 0) {
          showToast(`Question #${i + 1} ("${q.text.trim()}") requires at least one option`, 'error');
          return;
        }
      }
    }

    try {
      const res = await api(`/api/forms/${currentBuilderForm.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      currentBuilderForm = res.form;

      // If status changed, transition via explicit lifecycle endpoints (Priority 3)
      if (targetStatus && targetStatus !== currentBuilderForm.status) {
        let endpoint = `/api/forms/${currentBuilderForm.id}/publish`;
        if (targetStatus === 'paused') endpoint = `/api/forms/${currentBuilderForm.id}/pause`;
        else if (targetStatus === 'archived') endpoint = `/api/forms/${currentBuilderForm.id}/archive`;
        else if (targetStatus === 'draft') endpoint = `/api/forms/${currentBuilderForm.id}/draft`;

        const transitionRes = await api(endpoint, { method: 'PUT' });
        currentBuilderForm = transitionRes.form;
      }

      showToast('Form configuration saved successfully!', 'success');
      fetchCommonData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderInteractiveControlPreview(q) {
    switch (q.type) {
      case 'rating':
        return `
          <div style="display: flex; gap: 8px; font-size: 1.8rem; color: #f59e0b; cursor: pointer; user-select: none;">
            <span>★</span><span>★</span><span>★</span><span>★</span><span>★</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--neutral-500); margin-top: 4px;">Tap star to rate (1 - 5)</div>
        `;
      case 'nps':
        return `
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
              <button type="button" class="btn btn-secondary btn-sm" style="min-width: 32px; padding: 6px 6px; font-size: 0.82rem; font-weight: 600;">${n}</button>
            `).join('')}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--neutral-400); margin-top: 4px;">
            <span>0 = Not likely</span><span>10 = Extremely likely</span>
          </div>
        `;
      case 'choice':
        return `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${(q.options && q.options.length ? q.options : ['Option 1', 'Option 2']).map((opt, oi) => `
              <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 8px 12px; background: #ffffff; border: 1px solid var(--neutral-200); border-radius: var(--radius-md); cursor: pointer;">
                <input type="radio" name="prev_radio_${q.id}" ${oi === 0 ? 'checked' : ''}>
                <span>${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        `;
      case 'select':
        return `
          <select class="form-select">
            <option value="">-- Choose an option --</option>
            ${(q.options && q.options.length ? q.options : ['Option 1', 'Option 2']).map(opt => `
              <option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>
            `).join('')}
          </select>
        `;
      case 'checkbox':
        return `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${(q.options && q.options.length ? q.options : ['Option 1', 'Option 2']).map(opt => `
              <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 8px 12px; background: #ffffff; border: 1px solid var(--neutral-200); border-radius: var(--radius-md); cursor: pointer;">
                <input type="checkbox">
                <span>${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        `;
      case 'yesno':
        return `
          <div style="display: flex; gap: 10px;">
            <button type="button" class="btn btn-secondary" style="flex: 1; padding: 10px;">👍 Yes</button>
            <button type="button" class="btn btn-secondary" style="flex: 1; padding: 10px;">👎 No</button>
          </div>
        `;
      case 'multiline':
        return `<textarea class="form-textarea" rows="3" placeholder="${escapeHtml(q.placeholder || 'Type detailed comments here...')}"></textarea>`;
      case 'email':
        return `<input type="email" class="form-input" placeholder="student@example.edu">`;
      case 'phone':
        return `<input type="tel" class="form-input" placeholder="+91 98765 43210">`;
      case 'number':
        return `<input type="number" class="form-input" placeholder="Enter number...">`;
      case 'date':
        return `<input type="date" class="form-input">`;
      case 'text':
      default:
        return `<input type="text" class="form-input" placeholder="${escapeHtml(q.placeholder || 'Your response...')}">`;
    }
  }

  function previewCurrentForm() {
    if (!currentBuilderForm) return;
    const modal = document.getElementById('previewModal');
    const body = document.getElementById('previewModalBody');

    const cfConfig = currentBuilderForm.collegeFieldsConfig || {};
    const hasAcademicFields = Object.values(cfConfig).some(Boolean);

    body.innerHTML = `
      <div style="background:#ffffff; border-radius: var(--radius-lg); padding: 20px; border: 1px solid var(--neutral-200);">
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="font-size: 2.2rem; margin-bottom: 6px;">⚡</div>
          <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 4px;">${escapeHtml(currentBuilderForm.title)}</h3>
          <p class="text-muted text-sm">${escapeHtml(currentBuilderForm.description || '')}</p>
        </div>

        ${hasAcademicFields ? `
          <div style="background-color: var(--primary-light); padding: 14px; border-radius: var(--radius-md); margin-bottom: 18px; border: 1px solid #c7d2fe;">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary-text); margin-bottom: 10px;">🎓 Academic Details (Preview)</div>
            <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
              ${cfConfig.departmentEnabled ? `
                <select class="form-select" style="min-height: 36px; font-size: 0.85rem;">
                  <option>-- Select Department --</option>
                  <option>Computer Science & Engineering</option>
                  <option>Information Technology</option>
                </select>
              ` : ''}
              ${cfConfig.courseEnabled ? `
                <select class="form-select" style="min-height: 36px; font-size: 0.85rem;">
                  <option>-- Select Course / Program --</option>
                  <option>B.Tech Computer Science</option>
                </select>
              ` : ''}
              ${cfConfig.facultyEnabled ? `
                <select class="form-select" style="min-height: 36px; font-size: 0.85rem;">
                  <option>-- Select Faculty Member --</option>
                  <option>Dr. Rajesh Sharma</option>
                </select>
              ` : ''}
              ${cfConfig.subjectEnabled ? `
                <select class="form-select" style="min-height: 36px; font-size: 0.85rem;">
                  <option>-- Select Subject --</option>
                  <option>Data Structures & Algorithms</option>
                </select>
              ` : ''}
            </div>
          </div>
        ` : ''}

        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${(currentBuilderForm.questions || []).map((q, i) => `
            <div style="border-bottom: 1px solid var(--neutral-100); padding-bottom: 14px;">
              <div style="font-weight: 600; font-size: 0.92rem; margin-bottom: 8px; color: var(--neutral-800);">
                ${i + 1}. ${escapeHtml(q.text)} ${q.required ? '<span style="color:red">*</span>' : ''}
                ${q.conditional && q.conditional.dependsOn ? `<span style="font-size: 0.72rem; color: var(--primary); margin-left: 6px;">(Conditional: when ${escapeHtml(q.conditional.dependsOn)} ${escapeHtml(q.conditional.operator)} "${escapeHtml(q.conditional.value)}")</span>` : ''}
              </div>
              <div>
                ${renderInteractiveControlPreview(q)}
              </div>
            </div>
          `).join('')}
        </div>

        <div style="margin-top: 20px;">
          <button type="button" class="btn btn-primary btn-block" style="min-height: 44px; font-weight: 600;">
            Submit Feedback
          </button>
        </div>
      </div>
    `;

    modal.classList.add('active');
  }

  function closePreviewModal() {
    document.getElementById('previewModal')?.classList.remove('active');
  }

  function showQrForCurrentForm() {
    window.location.hash = '#/qr';
  }

  // --- Analytics ---
  async function loadAnalytics() {
    const timeRange = document.getElementById('analyticsTimeSelect')?.value || 'all';
    const locId = document.getElementById('analyticsLocationSelect')?.value || 'all';

    try {
      const data = await api(`/api/analytics/dashboard?timeRange=${timeRange}&locationId=${locId}`);

      // Rating distribution bar chart
      const distCtx = document.getElementById('ratingDistChartCanvas');
      if (distCtx) {
        if (ratingDistChartInstance) ratingDistChartInstance.destroy();

        ratingDistChartInstance = new Chart(distCtx, {
          type: 'bar',
          data: {
            labels: ['5 Stars', '4 Stars', '3 Stars', '2 Stars', '1 Star'],
            datasets: [
              {
                label: 'Responses Count',
                data: [
                  data.ratingCounts[5] || 0,
                  data.ratingCounts[4] || 0,
                  data.ratingCounts[3] || 0,
                  data.ratingCounts[2] || 0,
                  data.ratingCounts[1] || 0
                ],
                backgroundColor: ['#10b981', '#34d399', '#f59e0b', '#f87171', '#ef4444'],
                borderRadius: 6
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
          }
        });
      }

      // Location Breakdown list
      const locListEl = document.getElementById('analyticsLocationList');
      if (locListEl) {
        locListEl.innerHTML = data.locationStats.map(ls => `
          <div style="background-color: var(--neutral-50); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--neutral-200); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(ls.name)}</div>
              <div style="font-size: 0.8rem; color: var(--neutral-500);">${ls.total} total responses • ${ls.pending} pending</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 700; color: #f59e0b; font-size: 1.1rem;">★ ${ls.avgRating}</div>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('Error loading analytics:', err);
    }
  }

  function refreshAnalytics() {
    loadAnalytics();
  }

  function refreshDashboard() {
    loadDashboard();
  }

  // --- QR Codes ---
  async function loadQrView() {
    try {
      const res = await api('/api/forms');
      forms = res.forms || [];

      const select = document.getElementById('qrFormSelect');
      if (select) {
        select.innerHTML = forms.map(f => {
          const statusTag = f.status !== 'published' ? ` [${f.status.toUpperCase()}]` : '';
          return `<option value="${f.slug}">${escapeHtml(f.title)} (${escapeHtml(f.locationName || 'General')})${statusTag}</option>`;
        }).join('');

        const selectedSlug = select.value || (forms.length > 0 ? forms[0].slug : 'apex-downtown');
        renderSelectedQr(selectedSlug);
      } else {
        renderSelectedQr('apex-downtown');
      }
    } catch (err) {
      console.error('Error loading QR view:', err);
      renderSelectedQr('apex-downtown');
    }
  }

  function renderSelectedQr(slug) {
    const targetSlug = slug || (forms && forms[0] ? forms[0].slug : 'apex-downtown');
    const matchedForm = (forms || []).find(f => f.slug === targetSlug);
    const canvas = document.getElementById('qrCodeCanvas');
    const urlText = document.getElementById('qrTargetUrlText');
    const openLink = document.getElementById('qrOpenFormLink');

    const formUrl = `${window.location.origin}/feedback/${targetSlug}`;

    if (urlText) {
      if (matchedForm && matchedForm.status !== 'published') {
        urlText.innerHTML = `${escapeHtml(formUrl)} <div style="margin-top:6px; padding:4px 8px; font-size:0.8rem; border-radius:6px; background:#fef3c7; color:#92400e; font-weight:700;">⚠️ Form status is "${matchedForm.status.toUpperCase()}". Public responses will be blocked until published in Form Builder.</div>`;
      } else {
        urlText.textContent = formUrl;
      }
    }
    if (openLink) openLink.href = formUrl;

    if (canvas) {
      if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
        window.QRCode.toCanvas(canvas, formUrl, {
          width: 260,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        }, function (error) {
          if (error) {
            console.error('Client QR render error, using fallback:', error);
            loadQrImageFallback(canvas, formUrl);
          }
        });
      } else {
        loadQrImageFallback(canvas, formUrl);
      }
    }
  }

  function loadQrImageFallback(canvas, formUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      canvas.width = 260;
      canvas.height = 260;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 260, 260);
    };
    img.src = `/api/qr/image?url=${encodeURIComponent(formUrl)}&size=260`;
  }

  function copyQrLink() {
    const urlText = document.getElementById('qrTargetUrlText')?.textContent;
    if (urlText && navigator.clipboard) {
      navigator.clipboard.writeText(urlText).then(() => {
        showToast('Link copied to clipboard! Ready to share or print.', 'success');
      }).catch(() => {
        showToast('Could not copy link to clipboard', 'error');
      });
    }
  }

  function downloadQrPng() {
    const canvas = document.getElementById('qrCodeCanvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'feedback-qr.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('High-resolution QR code image downloaded', 'success');
    }
  }

  // --- Locations ---
  async function loadLocationsView() {
    try {
      const res = await api('/api/locations');
      locations = res.locations || [];

      const container = document.getElementById('locationsContainer');
      if (container) {
        container.innerHTML = locations.map(l => `
          <div class="card" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <h3 class="h3" style="font-size: 1.1rem;">${escapeHtml(l.name)}</h3>
              <span class="badge badge-positive">${escapeHtml(l.code || 'Active')}</span>
            </div>
            <p class="text-sm text-muted">📍 ${escapeHtml(l.address)}</p>
            <p class="text-sm" style="color: var(--neutral-700);">Manager: ${escapeHtml(l.manager || 'Sarah Jenkins')}</p>
            <div style="margin-top: 6px; display: flex; gap: 8px;">
              <a href="#/qr" class="btn btn-secondary btn-sm">Generate QR</a>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('Error loading locations view:', err);
    }
  }

  function openAddLocationModal() {
    document.getElementById('addLocationModal')?.classList.add('active');
  }

  function closeAddLocationModal() {
    document.getElementById('addLocationModal')?.classList.remove('active');
  }

  async function saveNewLocation(e) {
    e.preventDefault();
    const name = document.getElementById('newLocName').value.trim();
    const code = document.getElementById('newLocCode').value.trim();
    const address = document.getElementById('newLocAddress').value.trim();
    const manager = document.getElementById('newLocManager').value.trim();

    try {
      await api('/api/locations', {
        method: 'POST',
        body: JSON.stringify({ name, code, address, manager })
      });
      showToast(`Location ${name} added!`, 'success');
      closeAddLocationModal();
      loadLocationsView();
      fetchCommonData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Settings & Profile ---
  function toggleSettingsAddress(isOnline) {
    const block = document.getElementById('setAddressBlock');
    if (block) {
      block.style.display = isOnline ? 'none' : 'flex';
    }
  }

  function toggleRegisterAddress(isOnline) {
    const block = document.getElementById('regAddressBlock');
    if (block) {
      block.style.display = isOnline ? 'none' : 'flex';
    }
  }

  async function loadSettingsView() {
    if (!currentBusiness) {
      try {
        const res = await api('/api/auth/me');
        currentBusiness = res.business;
      } catch (err) {
        console.error('Failed to load business profile:', err);
      }
    }
    if (!currentBusiness) return;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('setBizName', currentBusiness.name || '');
    setVal('setCategory', currentBusiness.category || '');
    setVal('setEmail', currentBusiness.email || '');
    setVal('setPhone', currentBusiness.phone || '');

    const onlineCheck = document.getElementById('setIsOnlineOnly');
    if (onlineCheck) {
      onlineCheck.checked = Boolean(currentBusiness.isOnlineOnly);
      toggleSettingsAddress(onlineCheck.checked);
    }

    const addr = currentBusiness.address || {};
    setVal('setAddressLine1', addr.addressLine1 || (typeof currentBusiness.address === 'string' ? currentBusiness.address : ''));
    setVal('setAddressLine2', addr.addressLine2);
    setVal('setCity', addr.city);
    setVal('setState', addr.state);
    setVal('setPostalCode', addr.postalCode);
    setVal('setCountry', addr.country || 'India');

    // Populate academic master data
    const acad = currentBusiness.academicConfig || {};
    setVal('acadDepts', (acad.departments || []).join(', '));
    setVal('acadCourses', (acad.courses || []).join(', '));
    setVal('acadYears', (acad.academicYears || []).join(', '));
    setVal('acadSemesters', (acad.semesters || []).join(', '));
    setVal('acadSections', (acad.sections || []).join(', '));
    setVal('acadFaculty', (acad.faculty || []).map(f => `${f.name} | ${f.department}`).join('\n'));
    setVal('acadSubjects', (acad.subjects || []).map(s => `${s.name} | ${s.department}`).join('\n'));
  }

  async function saveSettings(e) {
    e.preventDefault();
    const name = document.getElementById('setBizName')?.value.trim();
    const category = document.getElementById('setCategory')?.value.trim();
    const email = document.getElementById('setEmail')?.value.trim();
    const phone = document.getElementById('setPhone')?.value.trim();
    const isOnlineOnly = Boolean(document.getElementById('setIsOnlineOnly')?.checked);

    const address = {
      addressLine1: document.getElementById('setAddressLine1')?.value.trim(),
      addressLine2: document.getElementById('setAddressLine2')?.value.trim(),
      city: document.getElementById('setCity')?.value.trim(),
      state: document.getElementById('setState')?.value.trim(),
      postalCode: document.getElementById('setPostalCode')?.value.trim(),
      country: document.getElementById('setCountry')?.value.trim() || 'India'
    };

    if (!name) {
      showToast('Business name is required', 'error');
      return;
    }

    try {
      const res = await api('/api/auth/business-settings', {
        method: 'PUT',
        body: JSON.stringify({ name, category, email, phone, isOnlineOnly, address })
      });
      currentBusiness = res.business;
      updateUserUI();
      showToast('Business settings saved successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function saveAcademicConfig(e) {
    e.preventDefault();
    const splitCsv = (id) => (document.getElementById(id)?.value || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const parseLines = (id) => (document.getElementById(id)?.value || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split('|').map(p => p.trim());
        return { name: parts[0] || '', department: parts[1] || '' };
      });

    const academicConfig = {
      departments: splitCsv('acadDepts'),
      courses: splitCsv('acadCourses'),
      academicYears: splitCsv('acadYears'),
      semesters: splitCsv('acadSemesters'),
      sections: splitCsv('acadSections'),
      faculty: parseLines('acadFaculty'),
      subjects: parseLines('acadSubjects')
    };

    try {
      const res = await api('/api/auth/business-settings', {
        method: 'PUT',
        body: JSON.stringify({
          name: currentBusiness ? currentBusiness.name : 'College',
          academicConfig
        })
      });
      currentBusiness = res.business;
      showToast('Academic master data saved successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Super Admin ---
  async function loadAdminView() {
    try {
      const res = await api('/api/admin/overview');
      const stats = res.stats;

      document.getElementById('admTotalBiz').textContent = stats.totalBusinesses;
      document.getElementById('admActiveBiz').textContent = `${stats.activeBusinesses} active`;
      document.getElementById('admTotalUsers').textContent = stats.totalUsers;
      document.getElementById('admTotalFeedbacks').textContent = stats.totalFeedbacks;

      // Businesses list
      const bizListEl = document.getElementById('adminBusinessesList');
      if (bizListEl) {
        bizListEl.innerHTML = res.businesses.map(b => `
          <div class="card" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="font-weight: 700; font-size: 1.05rem;">${b.logo || '🏢'} ${escapeHtml(b.name)}</div>
              <span class="badge ${b.active ? 'badge-positive' : 'badge-negative'}">${b.active ? 'Active' : 'Suspended'}</span>
            </div>
            <div class="text-sm text-muted">${escapeHtml(b.category)} • ${escapeHtml(b.address)}</div>
            <div style="font-size: 0.85rem; color: var(--neutral-600);">
              ${b.locationCount} locations • ${b.feedbackCount} feedbacks • Rating ★ ${b.averageRating}
            </div>
            <div style="margin-top: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="app.toggleBusinessStatus('${b.id}')">
                ${b.active ? 'Suspend Business' : 'Activate Business'}
              </button>
            </div>
          </div>
        `).join('');
      }

      // Audit logs
      const auditEl = document.getElementById('adminAuditList');
      if (auditEl) {
        auditEl.innerHTML = res.auditLogs.map(a => `
          <div style="background-color: var(--neutral-50); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.85rem; border: 1px solid var(--neutral-200);">
            <div style="display: flex; justify-content: space-between; font-weight: 600;">
              <span>${escapeHtml(a.action)}</span>
              <span style="font-size: 0.75rem; color: var(--neutral-400);">${new Date(a.timestamp).toLocaleString()}</span>
            </div>
            <div style="color: var(--neutral-600);">${escapeHtml(a.details)} (${escapeHtml(a.user)})</div>
          </div>
        `).join('');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function toggleBusinessStatus(id) {
    try {
      await api(`/api/admin/business/${id}/toggle`, { method: 'PATCH' });
      showToast('Business status updated', 'success');
      loadAdminView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Utilities ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  // --- Initial Bindings ---
  function bindEvents() {
    if (hamburgerBtn) hamburgerBtn.addEventListener('click', openMobileDrawer);
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeMobileDrawer);
    if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeMobileDrawer);

    // Nav link clicks close mobile drawer
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        closeMobileDrawer();
      });
    });

    // Hash change router
    window.addEventListener('hashchange', handleRoute);

    // Login Form Submit
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginError');
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.textContent : 'Sign In';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing In...';
          }
          if (errEl) {
            errEl.classList.add('hidden');
            errEl.textContent = '';
          }

          const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
          });
          token = data.token;
          localStorage.setItem('fh_token', token);
          currentUser = data.user;
          currentBusiness = data.business;
          if (errEl) errEl.classList.add('hidden');
          showToast(`Welcome back, ${currentUser.name}!`, 'success');
          updateUserUI();
          await fetchCommonData();
          window.location.hash = '#/dashboard';
          handleRoute();
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Invalid email or password';
            errEl.classList.remove('hidden');
          }
          showToast(err.message || 'Login failed', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = origBtnText;
          }
        }
      });
    }

    // Register Form Submit
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const businessName = document.getElementById('regBizName')?.value.trim();
        const businessType = document.getElementById('regBizType')?.value || 'other';
        const category = document.getElementById('regCategory')?.value.trim();
        const ownerName = document.getElementById('regOwnerName')?.value.trim();
        const email = document.getElementById('regEmail')?.value.trim();
        const password = document.getElementById('regPassword')?.value;
        const phone = document.getElementById('regPhone')?.value.trim();
        const isOnlineOnly = Boolean(document.getElementById('regIsOnlineOnly')?.checked);

        const address = {
          addressLine1: document.getElementById('regAddressLine1')?.value.trim(),
          addressLine2: document.getElementById('regAddressLine2')?.value.trim(),
          city: document.getElementById('regCity')?.value.trim(),
          state: document.getElementById('regState')?.value.trim(),
          postalCode: document.getElementById('regPostalCode')?.value.trim(),
          country: document.getElementById('regCountry')?.value.trim() || 'India'
        };

        const errEl = document.getElementById('regError');
        const submitBtn = registerForm.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.textContent : 'Create Account & Start';

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating Account...';
          }
          if (errEl) {
            errEl.classList.add('hidden');
            errEl.textContent = '';
          }

          const data = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              businessName,
              businessType,
              category,
              ownerName,
              email,
              password,
              phone,
              isOnlineOnly,
              address
            })
          });
          token = data.token;
          localStorage.setItem('fh_token', token);
          currentUser = data.user;
          currentBusiness = data.business;
          if (errEl) errEl.classList.add('hidden');
          showToast(`Welcome to FeedbackHub, ${ownerName}!`, 'success');
          updateUserUI();
          await fetchCommonData();
          window.location.hash = '#/dashboard';
          handleRoute();
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Registration failed';
            errEl.classList.remove('hidden');
          }
          showToast(err.message || 'Registration failed', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = origBtnText;
          }
        }
      });
    }
  }

  // Self init
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initSession();
  });

  return {
    navigate,
    switchDemo,
    logout,
    openMobileDrawer,
    closeMobileDrawer,
    refreshDashboard,
    filterInbox,
    exportCsv,
    openFeedbackModal,
    closeFeedbackModal,
    updateFeedbackStatus,
    updateFeedbackPriority,
    addInternalNote,
    resolveComplaint,
    loadBuilderForm,
    applySelectedTemplate,
    addBuilderQuestion,
    moveQuestion,
    updateQuestionField,
    updateQuestionConditional,
    addQuestionChoice,
    removeQuestionChoice,
    updateQuestionChoice,
    deleteQuestion,
    saveCurrentForm,
    previewCurrentForm,
    closePreviewModal,
    showQrForCurrentForm,
    refreshAnalytics,
    renderSelectedQr,
    copyQrLink,
    downloadQrPng,
    openAddLocationModal,
    closeAddLocationModal,
    saveNewLocation,
    saveSettings,
    saveAcademicConfig,
    toggleSettingsAddress,
    toggleRegisterAddress,
    toggleBusinessStatus
  };
})();
