/**
 * Reco Servicios — UI Component Library
 * Reusable render functions that produce HTML strings from service data.
 * Zero side-effects — each function takes data, returns markup.
 */

// --- Atomic components ---

function ServiceBadge(text, variant) {
  const styles = {
    accent: 'background:var(--accent);color:#fff',
    green: 'background:var(--green-mid);color:#fff',
    new: 'background:#FEF3C7;color:#92400E',
    core: 'background:#DCFCE7;color:#166534',
    ia: 'background:#FEF3C7;color:#92400E',
    free: 'background:var(--green-mid);color:#fff',
  };
  const style = styles[variant] || styles.accent;
  return `<div class="svc-tas-badge" style="${style}">${escapeHTML(text)}</div>`;
}

function ServiceTag(text) {
  return `<div class="svc-service-tag">${escapeHTML(text)}</div>`;
}

function FinTag(text, isNew) {
  return `<div class="svc-fin-tag${isNew ? ' new' : ''}">${escapeHTML(text)}</div>`;
}

function PlanCTA(label, action, style) {
  const cls = style === 'outline' ? 'plan-cta outline' : 'plan-cta';
  return `<button class="${cls}" onclick="RecoActions.handle('${escapeAttr(action)}')">${escapeHTML(label)}</button>`;
}

function FinCTA(label, action) {
  return `<button class="svc-fin-cta" onclick="RecoActions.handle('${escapeAttr(action)}')">${escapeHTML(label)} →</button>`;
}

function SectionHeader(tag, title, sub) {
  return `
    <div class="section-tag">${escapeHTML(tag)}</div>
    <h2 class="section-title" style="text-align:center">${escapeHTML(title)}</h2>
    <p class="section-sub" style="text-align:center;margin:0 auto 28px">${escapeHTML(sub)}</p>`;
}

function CategoryDivider(icon, title, count) {
  return `
    <div class="cat-divider">
      <h3>${escapeHTML(icon)} ${escapeHTML(title)}</h3>
      <div class="cat-count">${count} ${count === 1 ? 'producto' : 'productos'}</div>
    </div>`;
}

function InfoBanner(title, text) {
  return `
    <div class="svc-info-banner">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(text)}</span>
    </div>`;
}

function SearchBox(value, placeholder, onInputExpr) {
  return `
    <div class="svc-search">
      <input class="svc-search-input" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(value)}" oninput="${escapeAttr(onInputExpr)}" aria-label="Buscar servicios"/>
    </div>`;
}

function EmptyState(message) {
  return `
    <div style="text-align:center;padding:48px 24px;color:var(--ink-3)">
      <div style="font-size:48px;margin-bottom:12px">🔍</div>
      <div style="font-size:15px;font-weight:500">${escapeHTML(message)}</div>
    </div>`;
}

function LoadingState() {
  return `
    <div style="text-align:center;padding:48px 24px;color:var(--ink-3)">
      <div style="font-size:48px;margin-bottom:12px">⏳</div>
      <div style="font-size:15px;font-weight:500">Cargando servicios…</div>
    </div>`;
}

function ErrorState(message) {
  return `
    <div style="text-align:center;padding:48px 24px;color:var(--red)">
      <div style="font-size:48px;margin-bottom:12px">⚠️</div>
      <div style="font-size:15px;font-weight:500">${escapeHTML(message || 'Error al cargar los servicios')}</div>
    </div>`;
}

// --- Composite components ---

function ServiceCard(service) {
  const tag = service.tags[0] ? ServiceTag(service.tags[0]) : '';
  return `
    <button class="svc-service-card" onclick="RecoActions.handle('${escapeAttr(service.cta ? service.cta.action : 'noop')}', '${escapeAttr(service.id)}')">
      ${tag}
      <div class="svc-service-icon">${escapeHTML(service.icon)}</div>
      <div class="svc-service-title">${escapeHTML(service.name)}</div>
      <div class="svc-service-from">${escapeHTML(service.price.display)}</div>
    </button>`;
}

function TierCard(service) {
  const badge = service.tags[0] ? ServiceBadge(service.tags[0], service.featured ? 'accent' : service.price.value === 0 ? 'free' : 'accent') : '';
  const featuredClass = service.featured ? ' featured' : '';
  const checks = (service.highlights || []).map(h =>
    `<li>${h.startsWith('⚠') ? '' : '✓ '}${escapeHTML(h)}</li>`
  ).join('');
  const ctaStyle = service.cta?.style || 'outline';
  const ctaLabel = service.cta?.label || 'Solicitar';
  const ctaAction = service.cta?.action || 'noop';

  return `
    <div class="svc-tas-card${featuredClass}">
      ${badge}
      <div class="svc-tas-icon">${escapeHTML(service.icon)}</div>
      <h3>${escapeHTML(service.name)}</h3>
      <div class="svc-tas-price">${escapeHTML(service.price.display)} ${service.price.suffix ? `<small>${escapeHTML(service.price.suffix)}</small>` : ''}</div>
      <ul class="svc-tas-checks">${checks}</ul>
      ${PlanCTA(ctaLabel, ctaAction, ctaStyle)}
    </div>`;
}

function FinanceCard(service) {
  const tag = service.tags[0]
    ? FinTag(service.tags[0], service.tags[0] === 'Nuevo')
    : '';
  const ctaLabel = service.cta?.label || 'Ver más';
  const ctaAction = service.cta?.action || 'noop';

  return `
    <div class="svc-fin-card">
      ${tag}
      <div class="svc-fin-icon">${escapeHTML(service.icon)}</div>
      <div class="svc-fin-title">${escapeHTML(service.name)}</div>
      <div class="svc-fin-desc">${escapeHTML(service.description)}</div>
      <div class="svc-fin-price">${escapeHTML(service.price.display)}</div>
      ${FinCTA(ctaLabel, ctaAction)}
    </div>`;
}

function LegalCard(service) {
  const tag = service.tags[0]
    ? FinTag(service.tags[0], service.tags[0] === 'Nuevo')
    : '';
  const ctaLabel = service.cta?.label || 'Solicitar';
  const ctaAction = service.cta?.action || 'noop';

  return `
    <div class="svc-legal-card">
      ${tag}
      <div class="svc-fin-icon">${escapeHTML(service.icon)}</div>
      <div class="svc-fin-title">${escapeHTML(service.name)}</div>
      <div class="svc-fin-desc">${escapeHTML(service.description)}</div>
      <div class="svc-fin-price">${escapeHTML(service.price.display)}</div>
      ${FinCTA(ctaLabel, ctaAction)}
    </div>`;
}

function FotoCard(service) {
  const badge = service.featured
    ? `<div class="foto-badge">Recomendado</div>`
    : service.tags[0] === 'Pack'
      ? `<div class="foto-badge" style="background:var(--green-mid)">Pack</div>`
      : service.tags[0]
        ? FinTag(service.tags[0], true)
        : '';
  const featuredClass = service.featured ? ' featured' : '';
  const ctaLabel = service.cta?.label || 'Solicitar';
  const ctaAction = service.cta?.action || 'noop';

  return `
    <div class="svc-foto-card${featuredClass}">
      ${badge}
      <div class="svc-fin-icon">${escapeHTML(service.icon)}</div>
      <div class="svc-fin-title">${escapeHTML(service.name)}</div>
      <div class="svc-fin-desc">${escapeHTML(service.description)}</div>
      <div class="svc-fin-price">${escapeHTML(service.price.display)}</div>
      ${FinCTA(ctaLabel, ctaAction)}
    </div>`;
}

function HeroCard(service) {
  const checks = (service.highlights || []).map(h => `<li>✓ ${escapeHTML(h)}</li>`).join('');
  const ctaLabel = service.cta?.label || 'Comenzar';
  const ctaAction = service.cta?.action || 'noop';

  return `
    <div class="svc-hero-card">
      <div class="svc-eyebrow">${escapeHTML(service.category.toUpperCase())}</div>
      <h2 class="font-serif" style="font-size:30px;margin:6px 0 10px;color:#fff">${escapeHTML(service.name)}</h2>
      <p>${escapeHTML(service.description)}</p>
      <ul class="svc-checks">${checks}</ul>
      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
        <button class="plan-cta" style="width:auto;padding:12px 24px" onclick="RecoActions.handle('${escapeAttr(ctaAction)}')">${escapeHTML(ctaLabel)}</button>
      </div>
    </div>`;
}

function SideTile(service) {
  return `
    <div class="svc-tile">
      <div class="svc-tile-title">${escapeHTML(service.icon)} ${escapeHTML(service.name)}</div>
      <div class="svc-tile-desc">${escapeHTML(service.description)}</div>
    </div>`;
}

// --- Category renderers (delegated to specialized UI modules) ---

const CATEGORY_RENDERERS = {
  [CATEGORIES.PAGOS]: () => RentUI.render(),
  [CATEGORIES.MANTENIMIENTO]: () => MaintenanceUI.render(),
  [CATEGORIES.TASACIONES]: () => ValuationUI.render(),
  [CATEGORIES.FINANZAS]: () => FinanceUI.render(),
  [CATEGORIES.FOTOGRAFIA]: () => VisualUI.render(),
  [CATEGORIES.LEGAL]: () => LegalUI.render(),
  [CATEGORIES.RECO_AGENT]: () => AgentUI.render(),
  [CATEGORIES.PROPERTY_MANAGEMENT]: () => PropertyUI.render(),
};
