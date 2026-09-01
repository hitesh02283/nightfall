'use strict';

/*
 * Nightfall account-profile renderer.
 *
 * There is NO demo account data in Nightfall. The Overview shows a clean
 * waiting/disconnected state until real data arrives from /api/live (live
 * local identity + rank/RR/peak) or /api/profile-summary (historical stats).
 * Individual statistics that cannot be computed are shown as N/A — never
 * faked. Secret data never reaches the browser.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const textTargets = [
    'rank-current', 'rank-rr', 'rank-peak', 'rank-peak-label',
    'stat-winrate', 'stat-kd', 'stat-hs', 'stat-act',
    'fav-name', 'fav-wr', 'fav-kd', 'fav-games',
    'form-count', 'form-record',
  ];

  const chartEl = $('form-chart');
  const prevEl = $('match-preview');

  function txt(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }
  function nA_(prefix) { return (prefix ? prefix : '') + 'N/A'; }

  // Clean waiting state — the ONLY fallback. No demo/hard-coded values.
  function waitingValues() {
    return {
      profileName: 'Waiting…', profileTag: 'for Riot Client',
      rankCurrent: '—', rankRr: '—', rankPeak: '—', rankPeakLabel: 'PEAK',
    };
  }

  function setSidebar(name, tag) {
    const profile = document.querySelector('.profile');
    if (!profile) return;
    const nameEl = profile.querySelector('b');
    const tagEl = profile.querySelector('span');
    if (nameEl) nameEl.textContent = name;
    if (tagEl) tagEl.textContent = tag;
  }

  function showWaiting() {
    const live = !!(window.NightfallLiveActive);
    // Live identity/rank stay untouched while the live client is connected.
    if (!live) {
      txt('rank-current', '—'); txt('rank-rr', '—');
      txt('rank-peak', '—'); txt('rank-peak-label', 'PEAK');
      setSidebar('Waiting…', 'for Riot Client');
    }
    txt('stat-winrate', '—'); txt('stat-kd', '—'); txt('stat-hs', '—');
    txt('stat-act', '—');
    txt('fav-name', '—'); txt('fav-wr', '—'); txt('fav-kd', '—'); txt('fav-games', '—');
    txt('form-count', '—'); txt('form-record', '—');
    if (chartEl) chartEl.innerHTML = '<span class="dim" style="align-self:end;padding-bottom:10px">Waiting for data</span>';
    if (prevEl) prevEl.innerHTML = '<div class="empty-state"><b>◌</b><h2>Waiting for data</h2><p>Connect an account source to see your recent matches here.</p></div>';
    // On live disconnect (see app.js applyLiveProfile) restore this waiting state.
    window.NightfallOverviewFallback = waitingValues();
  }

  function showLoading() {
    const live = !!(window.NightfallLiveActive);
    if (!live) {
      txt('rank-current', '…'); txt('rank-rr', '…');
      txt('rank-peak', '…'); txt('rank-peak-label', 'PEAK');
    }
    txt('stat-winrate', '…'); txt('stat-kd', '…'); txt('stat-hs', '…');
    txt('stat-act', '…');
    txt('fav-name', '…'); txt('fav-wr', '…'); txt('fav-kd', '…'); txt('fav-games', '…');
    txt('form-count', '…'); txt('form-record', '…');
    if (chartEl) chartEl.innerHTML = '<span class="dim" style="align-self:end;padding-bottom:10px">Loading…</span>';
    if (prevEl) prevEl.innerHTML = '<div class="empty-state"><b>◌</b><h2>Loading account data…</h2></div>';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
  function render(data) {
    const stats = data.stats || {};
    const rank = data.rank || {};
    const live = !!(window.NightfallLiveActive);

    // Wait-state fallback for live-disconnect ONLY if no real summary exists.
    let fallback = waitingValues();
    if (data.account && data.account.gameName) {
      fallback.profileName = data.account.gameName;
      fallback.profileTag = data.account.tagLine ? `#${data.account.tagLine}` : '';
    }
    if (rank.name) {
      fallback.rankCurrent = rank.name;
      fallback.rankRr = rank.rr != null ? `${rank.rr} RR` : '—';
      fallback.rankPeak = rank.peak || 'N/A';
      fallback.rankPeakLabel = 'PEAK';
    }
    window.NightfallOverviewFallback = fallback;

    // Rank / RR / peak — only update when live board data is NOT active (live wins).
    if (!live) {
      if (rank.name) {
        txt('rank-current', rank.name);
        txt('rank-rr', rank.rr != null ? `${rank.rr} RR` : '—');
        if (rank.peak) {
          txt('rank-peak', rank.peak);
          txt('rank-peak-label', 'PEAK');
        } else {
          txt('rank-peak', nA_());
          txt('rank-peak-label', 'PEAK');
        }
      } else {
        txt('rank-current', nA_());
        txt('rank-rr', nA_());
        txt('rank-peak', nA_());
        txt('rank-peak-label', 'PEAK');
      }
    }

    // Stat grid — real (or N/A) only, never demo.
    txt('stat-winrate', stats.winRate != null ? `${stats.winRate}%` : nA_());
    txt('stat-kd', stats.kd != null ? stats.kd : nA_());
    txt('stat-hs', stats.hs != null ? `${stats.hs}%` : nA_());
    txt('stat-act', rank.name ? rank.name : nA_());

    // Favorite agent.
    if (stats.favoriteAgent) {
      const f = stats.favoriteAgent;
      txt('fav-name', f.name);
      txt('fav-wr', f.winRate != null ? `${f.winRate}%` : nA_());
      txt('fav-kd', f.kd != null ? f.kd : nA_());
      txt('fav-games', f.games != null ? f.games : nA_());
    } else {
      txt('fav-name', '—');
      txt('fav-wr', nA_()); txt('fav-kd', nA_()); txt('fav-games', nA_());
    }

    // Recent form bar chart (W/L) — real only.
    const form = Array.isArray(data.form) ? data.form : [];
    const wins = form.filter((r) => r === 'W').length;
    const played = form.length;
    if (chartEl) {
      chartEl.innerHTML = form.length
        ? form.map((r) => `<i class="bar ${r === 'L' ? 'loss' : ''}" style="height:${r === 'L' ? 42 : 90}%"></i>`).join('')
        : '<span class="dim" style="align-self:end;padding-bottom:10px">No recent competitive data.</span>';
    }
    txt('form-count', played ? `${played} matches` : nA_());
    txt('form-record', played ? `${wins}W — ${played - wins}L` : nA_());

    // Latest matches — real only.
    const rows = Array.isArray(data.matches) ? data.matches : [];
    if (prevEl) {
      prevEl.innerHTML = rows.length
        ? rows.map((m) => `<div class="match-row"><b class="outcome ${m.result === 'VICTORY' ? 'win' : 'loss'}">${escapeHtml(m.result)}</b><span><b>${escapeHtml(m.map)}</b> <i class="dim">· ${escapeHtml(m.mode)}</i></span><span class="optional">${escapeHtml(m.agent)}</span><span class="optional">${escapeHtml(m.kda)}</span><span><b>${escapeHtml(m.score)}</b> <i class="dim">${escapeHtml(m.date)}</i></span></div>`).join('')
        : '<div class="empty-state"><b>◌</b><h2>No recent matches</h2><p>Play a competitive match to populate this list.</p></div>';
    }

    // Sidebar profile — only when live is NOT active (live wins).
    if (!live && data.account && data.account.gameName) {
      setSidebar(data.account.gameName, data.account.tagLine ? `#${data.account.tagLine}` : '');
    }
  }

  async function run() {
    try {
      showLoading();
      let data = null;
      try {
        data = await fetch('/api/profile-summary').then((r) => r.json());
      } catch { data = null; }
      if (!data || data.source === 'none' || !data.source) {
        // No real account source available — show the clean waiting state.
        showWaiting();
        return;
      }
      render(data);
    } catch (error) {
      // Never let a data error crash the page; fall back to waiting, not demo.
      showWaiting();
    }
  }

  run();
})();

