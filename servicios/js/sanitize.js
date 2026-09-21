/**
 * Reco Servicios — HTML Sanitization
 * Prevents XSS when interpolating user-provided data into innerHTML templates.
 */

const RecoSanitize = (() => {
  const _escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  const _escapeRe = /[&<>"']/g;

  function escapeHTML(str) {
    if (str == null) return '';
    return String(str).replace(_escapeRe, ch => _escapeMap[ch]);
  }

  function escapeAttr(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return { escapeHTML, escapeAttr };
})();

window.escapeHTML = RecoSanitize.escapeHTML;
window.escapeAttr = RecoSanitize.escapeAttr;
