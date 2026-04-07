(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LunarUiRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizedName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isDemoOrTestUserName(name) {
    const normalized = normalizedName(name);
    if (!normalized) return false;
    return normalized === 'demo user'
      || normalized === 'demo account'
      || normalized === 'test user'
      || normalized === 'test account'
      || normalized.startsWith('demo ')
      || normalized.startsWith('test ');
  }

  function filterPublicLeaderboardRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => !isDemoOrTestUserName(row && row.name));
  }

  function shouldShowEventRecap(event) {
    const resultSummary = event && (event.result_summary || event.event_results || null);
    if (resultSummary) return true;
    const liveSummary = event && event.live_summary;
    if (liveSummary && (liveSummary.results_url || liveSummary.winner || liveSummary.winner_recommendation)) return true;
    return false;
  }

  function getAvailabilityInputValue(value) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }

  function getAvailabilityPlaceholder(value) {
    return getAvailabilityInputValue(value) ? '' : 'Set hours';
  }

  function getInitialPastEventsVisibleCount() {
    return 3;
  }

  function shouldShowPastEventsToggle(events) {
    return (Array.isArray(events) ? events.length : 0) > getInitialPastEventsVisibleCount();
  }

  function getFoyerLowContentMessage(ideas) {
    const count = Array.isArray(ideas) ? ideas.length : 0;
    if (count > 0 && count <= 2) {
      return 'Still early here — click a bubble to explore it, join a team, or help shape what gets built next.';
    }
    return '';
  }

  function getLeaderboardWonDisplay(count) {
    const numeric = Number(count || 0);
    return numeric > 0 ? `${numeric} won` : '—';
  }

  function getLeaderboardCountDisplay(count, label) {
    const numeric = Number(count || 0);
    return numeric > 0 ? `${numeric.toLocaleString()}${label ? ` ${label}` : ''}` : '—';
  }

  function getDecksEmptyStateCopy(search) {
    const query = String(search || '').trim();
    if (query) {
      return {
        title: 'No decks match your search',
        body: `Try a different keyword or clear “${query}”.`,
        ctaLabel: 'Clear Search',
        ctaAction: 'clearSearch()',
      };
    }
    return {
      title: 'No presentations yet',
      body: 'Be the first to upload an HTML presentation',
      ctaLabel: 'Upload Your Deck',
      ctaAction: "document.getElementById('uploadModal').classList.add('open')",
    };
  }

  function getProjectStatusTone(status) {
    return String(status || '').toLowerCase() === 'shipped' ? 'shipped' : 'building';
  }

  function getProfileBannerPresets() {
    return [
      { id: 'lunar-dawn', label: 'Lunar Dawn' },
      { id: 'saturn-violet', label: 'Saturn Violet' },
      { id: 'bitcoin-sunset', label: 'Bitcoin Sunset' },
    ];
  }

  return {
    filterPublicLeaderboardRows,
    getAvailabilityInputValue,
    getAvailabilityPlaceholder,
    getDecksEmptyStateCopy,
    getFoyerLowContentMessage,
    getInitialPastEventsVisibleCount,
    getLeaderboardCountDisplay,
    getLeaderboardWonDisplay,
    getProfileBannerPresets,
    getProjectStatusTone,
    isDemoOrTestUserName,
    shouldShowEventRecap,
    shouldShowPastEventsToggle,
  };
});
