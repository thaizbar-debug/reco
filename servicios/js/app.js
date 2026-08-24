/**
 * Reco Servicios — Main Orchestrator
 * Wires data, components, analytics, and actions together.
 * Default view: Jobs ("¿Qué necesitas hacer?")
 * Depends on: data.js, jobs-data.js, components.js, analytics.js, actions.js, jobs-ui.js (loaded before this).
 */

const JOBS_VIEW = '__jobs__';

/** Focus the main content heading or fallback to the content panel after view transitions. */
function focusContent() {
  const el = document.getElementById('svcContent');
  if (!el) return;
  const heading = el.querySelector('h2, h3, [tabindex="-1"]');
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  else { el.setAttribute('tabindex', '-1'); el.focus(); }
}

const RecoApp = (() => {
  let _currentTab = JOBS_VIEW;
  let _searchQuery = '';
  let _pendingServiceId = null;

  function init() {
    _renderTabs();
    _render();
    _initTabKeyboard();
    RecoAnalytics.pageViewed();
  }

  function _renderTabs() {
    const el = document.getElementById('svcTabs');
    if (!el) return;

    el.setAttribute('role', 'tablist');

    const allTabs = [{ id: JOBS_VIEW, icon: '🏠', label: 'Inicio' }].concat(
      TABS.map(t => ({ id: t.id, icon: t.icon, label: t.label }))
    );

    el.innerHTML = allTabs.map(t => {
      const isActive = _currentTab === t.id;
      return `<button class="svc-tab${isActive ? ' active' : ''}" data-tab="${escapeAttr(t.id)}" role="tab" aria-selected="${isActive}" tabindex="${isActive ? '0' : '-1'}" aria-controls="svcContent" onclick="RecoApp.setTab('${escapeAttr(t.id)}')">${escapeHTML(t.icon)} ${escapeHTML(t.label)}</button>`;
    }).join('');
  }

  /** Keyboard navigation for the tablist (arrow keys, Home, End, Enter, Space). */
  function _initTabKeyboard() {
    const el = document.getElementById('svcTabs');
    if (!el) return;

    el.addEventListener('keydown', function(e) {
      const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
      if (tabs.length === 0) return;
      const current = document.activeElement;
      const idx = tabs.indexOf(current);
      if (idx === -1) return;

      let newIdx = idx;
      switch (e.key) {
        case 'ArrowRight':
          newIdx = (idx + 1) % tabs.length;
          e.preventDefault();
          break;
        case 'ArrowLeft':
          newIdx = (idx - 1 + tabs.length) % tabs.length;
          e.preventDefault();
          break;
        case 'Home':
          newIdx = 0;
          e.preventDefault();
          break;
        case 'End':
          newIdx = tabs.length - 1;
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          current.click();
          return;
        default:
          return;
      }

      tabs[newIdx].focus();
    });
  }

  function setTab(id, serviceId) {
    const prevTab = _currentTab;
    _currentTab = id;
    _searchQuery = '';
    _pendingServiceId = serviceId || null;
    if (id === JOBS_VIEW) JobsUI.reset();
    _renderTabs();
    RecoAnalytics.tabSwitched(prevTab, id);
    _render();
    focusContent();
  }

  function getPendingServiceId() {
    const id = _pendingServiceId;
    _pendingServiceId = null;
    return id;
  }

  function setSearch(value) {
    _searchQuery = value;
    _render();
    if (value.length >= 3) {
      const results = searchServices(_currentTab, value);
      RecoAnalytics.searchPerformed(_currentTab, value, results.length);
    }
  }

  function _render() {
    const el = document.getElementById('svcContent');
    if (!el) return;

    if (_currentTab === JOBS_VIEW) {
      el.innerHTML = JobsUI.render();
      return;
    }

    const renderer = CATEGORY_RENDERERS[_currentTab];
    if (!renderer) {
      el.innerHTML = ErrorState('Categoría no encontrada');
      return;
    }

    const services = getServicesByCategory(_currentTab);
    el.innerHTML = renderer(services, _searchQuery);
  }

  function getCurrentTab() {
    return _currentTab;
  }

  function getSearchQuery() {
    return _searchQuery;
  }

  return {
    init,
    setTab,
    setSearch,
    getCurrentTab,
    getSearchQuery,
    getPendingServiceId,
  };
})();

document.addEventListener('DOMContentLoaded', function() {
  // Initialize property context from URL params (Flow 2)
  if (typeof PropertyContext !== 'undefined') {
    PropertyContext.initFromUrl();
  }

  // Restore property context after auth redirect (Flow 3)
  if (typeof PropertyContext !== 'undefined' && typeof RecoFirebase !== 'undefined' && RecoFirebase.auth) {
    RecoFirebase.auth.onAuthStateChanged(function(user) {
      if (user && PropertyContext.restoreAfterAuth()) {
        console.log('[RecoApp] Property context restored after auth');
      }
    });
  }

  RecoApp.init();
});
