/**
 * Reco Servicios — Main Orchestrator
 * Wires data, components, analytics, and actions together.
 * Default view: Jobs ("¿Qué necesitas hacer?")
 * Depends on: data.js, jobs-data.js, components.js, analytics.js, actions.js, jobs-ui.js (loaded before this).
 */

const JOBS_VIEW = '__jobs__';

const RecoApp = (() => {
  let _currentTab = JOBS_VIEW;
  let _searchQuery = '';

  function init() {
    _renderTabs();
    _render();
    RecoAnalytics.pageViewed();
  }

  function _renderTabs() {
    const el = document.getElementById('svcTabs');
    if (!el) return;

    const jobsTab = `<button class="svc-tab${_currentTab === JOBS_VIEW ? ' active' : ''}" data-tab="${JOBS_VIEW}" onclick="RecoApp.setTab('${JOBS_VIEW}')">🏠 Inicio</button>`;

    const categoryTabs = TABS.map(t =>
      `<button class="svc-tab${_currentTab === t.id ? ' active' : ''}" data-tab="${t.id}" onclick="RecoApp.setTab('${t.id}')">${t.icon} ${t.label}</button>`
    ).join('');

    el.innerHTML = jobsTab + categoryTabs;
  }

  function setTab(id) {
    const prevTab = _currentTab;
    _currentTab = id;
    _searchQuery = '';
    if (id === JOBS_VIEW) JobsUI.reset();
    _renderTabs();
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
  };
})();

document.addEventListener('DOMContentLoaded', RecoApp.init);
