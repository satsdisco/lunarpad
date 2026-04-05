// Shared auth + notifications
let _notifInterval = null;
let _currentUser = null;

async function initAuth(onUser) {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    const area = document.getElementById('userArea');
    if (!area) return;
    if (data.user) {
      _currentUser = data.user;
      area.innerHTML = `
        <div class="notif-wrapper">
          <button class="notif-bell" id="notifBell" aria-label="Notifications">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span class="notif-badge" id="notifBadge" style="display:none">0</span>
          </button>
          <div class="notif-dropdown" id="notifDropdown">
            <div class="notif-header">
              <span>Notifications</span>
              <button onclick="markAllRead()">Mark all read</button>
            </div>
            <div class="notif-list" id="notifList">
              <div class="notif-empty">No notifications yet</div>
            </div>
          </div>
        </div>
        <div class="user-menu">
          <div class="user-pill" onclick="this.parentElement.querySelector('.user-dropdown').classList.toggle('open')">
            <img src="${data.user.avatar || ''}" alt="" onerror="this.style.display='none'">
            <span>${data.user.name || data.user.email}</span>
          </div>
          <div class="user-dropdown">
            <a href="/profile">My Profile</a>
            <div class="dev-switcher" id="devSwitcher" style="display:none">
              <div style="padding:4px 10px;font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em">Switch user</div>
              <a href="/dev/switch/alice" class="dev-switch-btn">Alice (Dev)</a>
              <a href="/dev/switch/bob" class="dev-switch-btn">Bob (Dev)</a>
            </div>
            <a href="/auth/logout">Sign out</a>
          </div>
        </div>`;

      // Close dropdowns on outside click
      document.addEventListener('click', e => {
        if (!e.target.closest('.user-menu')) {
          document.querySelectorAll('.user-dropdown').forEach(d => d.classList.remove('open'));
        }
        if (!e.target.closest('.notif-wrapper')) {
          const dd = document.getElementById('notifDropdown');
          if (dd) dd.classList.remove('open');
        }
      });

      // Bell click
      document.getElementById('notifBell').addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('notifDropdown').classList.toggle('open');
      });

      // Show dev switcher on localhost
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        const sw = document.getElementById('devSwitcher');
        if (sw) sw.style.display = '';
      }

      // Start polling
      pollNotifications();
      _notifInterval = setInterval(pollNotifications, 30000);

      // Pause when tab hidden
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          clearInterval(_notifInterval);
        } else {
          pollNotifications();
          _notifInterval = setInterval(pollNotifications, 30000);
        }
      });

      // Page-specific callback
      if (onUser) onUser(data.user);
    } else {
      area.innerHTML = '<a href="/welcome" class="sign-in-btn">Sign in</a>';
    }
  } catch(e) { console.warn('Auth check failed'); }
}

async function pollNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    const badge = document.getElementById('notifBadge');
    const list = document.getElementById('notifList');
    if (!badge || !list) return;

    if (data.unread_count > 0) {
      badge.textContent = data.unread_count > 99 ? '99+' : data.unread_count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    if (!data.notifications || data.notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }

    list.innerHTML = data.notifications.map(n => {
      const href = notifHref(n);
      const time = timeAgo(n.created_at);
      const icon = n.type === 'comment' ? '💬' : n.type === 'reply' ? '↩️' : n.type === 'vote' ? '👍' : '⚡';
      const text = notifText(n);
      return `<a class="notif-item${n.read ? '' : ' unread'}" href="${href}" onclick="markRead('${n.id}')" title="${time}">
        <span class="notif-icon">${icon}</span>
        <span class="notif-body">${text}<span class="notif-time">${time}</span></span>
      </a>`;
    }).join('');
  } catch(e) { console.warn('Notification poll failed'); }
}

function notifText(n) {
  const name = escHtml(n.actor_name);
  const target = escHtml(n.target_name || n.target_type);
  if (n.type === 'comment') return `<b>${name}</b> commented on ${target}`;
  if (n.type === 'reply') return `<b>${name}</b> replied in a thread on ${target}`;
  if (n.type === 'vote') return `<b>${name}</b> upvoted ${target}`;
  if (n.type === 'zap') return `<b>${name}</b> zapped ${target}`;
  return `<b>${name}</b> interacted with ${target}`;
}

function notifHref(n) {
  const hash = (n.type === 'comment' || n.type === 'reply') ? '#comments' : '';
  if (n.target_type === 'deck') return '/deck/' + n.target_id + hash;
  if (n.target_type === 'project') return '/project/' + n.target_id + hash;
  if (n.target_type === 'comment') return '#';
  return '#';
}

async function markRead(id) {
  try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); } catch {}
}

async function markAllRead() {
  try {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    pollNotifications();
  } catch {}
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(then).toLocaleDateString();
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
