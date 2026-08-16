/**
 * Reco Servicios — Main Orchestrator
 * Wires data, components, analytics, and actions together.
 * Depends on: data.js, components.js, analytics.js, actions.js (loaded before this).
 */

const RecoApp = (() => {
  let _currentTab = CATEGORIES.PAGOS;
  let _searchQuery = '';

  function init() {
    _renderTabs();
    _render();
    RecoAnalytics.pageViewed();
  }

  function _renderTabs() {
    const el = document.getElementById('svcTabs');
    if (!el) return;
    el.innerHTML = TABS.map(t =>
      `<button class="svc-tab${_currentTab === t.id ? ' active' : ''}" data-tab="${t.id}" onclick="RecoApp.setTab('${t.id}')">${t.icon} ${t.label}</button>`
    ).join('');
  }

  function setTab(id) {
    const prevTab = _currentTab;
    _currentTab = id;
    _searchQuery = '';
    document.querySelectorAll('.svc-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === id)
    );
    RecoAnalytics.tabSwitched(prevTab, id);
    _render();
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
  };
})();

document.addEventListener('DOMContentLoaded', RecoApp.init);
