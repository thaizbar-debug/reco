/**
 * Reco Servicios — Input Validation
 * Shared validators for form data across all UI modules.
 */

const RecoValidation = (() => {
  const MAX_TEXT_LENGTH = 500;
  const MAX_NAME_LENGTH = 100;
  const MAX_ADDRESS_LENGTH = 200;

  const PATTERNS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^[0-9\s\-+()]{7,15}$/,
    peruPhone: /^9\d{8}$/,
    numeric: /^\d+$/,
    alphaSpaces: /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/,
  };

  function validateEmail(value) {
    if (!value || !value.trim()) return { valid: false, error: 'Email es requerido' };
    if (!PATTERNS.email.test(value.trim())) return { valid: false, error: 'Email no válido' };
    return { valid: true, value: value.trim() };
  }

  function validatePhone(value) {
    if (!value || !value.trim()) return { valid: false, error: 'Teléfono es requerido' };
    const cleaned = value.replace(/[\s\-()]/g, '');
    if (!PATTERNS.phone.test(cleaned)) return { valid: false, error: 'Teléfono no válido' };
    return { valid: true, value: cleaned };
  }

  function validateName(value) {
    if (!value || !value.trim()) return { valid: false, error: 'Nombre es requerido' };
    const trimmed = value.trim();
    if (trimmed.length > MAX_NAME_LENGTH) return { valid: false, error: `Máximo ${MAX_NAME_LENGTH} caracteres` };
    if (trimmed.length < 2) return { valid: false, error: 'Mínimo 2 caracteres' };
    return { valid: true, value: trimmed };
  }

  function validateText(value, opts = {}) {
    const { required = false, maxLength = MAX_TEXT_LENGTH, label = 'Campo' } = opts;
    if (!value || !value.trim()) {
      return required ? { valid: false, error: `${label} es requerido` } : { valid: true, value: '' };
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) return { valid: false, error: `Máximo ${maxLength} caracteres` };
    return { valid: true, value: trimmed };
  }

  function validateNumber(value, opts = {}) {
    const { min = 0, max = Infinity, required = false, label = 'Campo' } = opts;
    if (value == null || value === '') {
      return required ? { valid: false, error: `${label} es requerido` } : { valid: true, value: null };
    }
    const num = Number(value);
    if (isNaN(num)) return { valid: false, error: `${label} debe ser numérico` };
    if (num < min) return { valid: false, error: `Mínimo ${min}` };
    if (num > max) return { valid: false, error: `Máximo ${max}` };
    return { valid: true, value: num };
  }

  function validateAddress(value) {
    if (!value || !value.trim()) return { valid: false, error: 'Dirección es requerida' };
    const trimmed = value.trim();
    if (trimmed.length > MAX_ADDRESS_LENGTH) return { valid: false, error: `Máximo ${MAX_ADDRESS_LENGTH} caracteres` };
    if (trimmed.length < 5) return { valid: false, error: 'Dirección muy corta' };
    return { valid: true, value: trimmed };
  }

  function validateRequired(value, label) {
    if (!value || (typeof value === 'string' && !value.trim())) {
      return { valid: false, error: `${label || 'Campo'} es requerido` };
    }
    return { valid: true, value: typeof value === 'string' ? value.trim() : value };
  }

  function validateForm(data, rules) {
    const errors = {};
    let isValid = true;

    for (const [field, rule] of Object.entries(rules)) {
      const result = rule(data[field]);
      if (!result.valid) {
        errors[field] = result.error;
        isValid = false;
      }
    }

    return { valid: isValid, errors };
  }

  function showFieldError(inputEl, message) {
    clearFieldError(inputEl);
    if (!inputEl || !message) return;
    inputEl.style.borderColor = 'var(--red, #9B2020)';
    const err = document.createElement('div');
    err.className = 'reco-field-error';
    err.textContent = message;
    err.style.cssText = 'color:var(--red,#9B2020);font-size:12px;margin-top:4px;font-weight:500';
    inputEl.parentNode.insertBefore(err, inputEl.nextSibling);
  }

  function clearFieldError(inputEl) {
    if (!inputEl) return;
    inputEl.style.borderColor = '';
    const next = inputEl.nextSibling;
    if (next && next.className === 'reco-field-error') next.remove();
  }

  function clearAllErrors(container) {
    if (!container) return;
    container.querySelectorAll('.reco-field-error').forEach(el => el.remove());
    container.querySelectorAll('[style*="border-color"]').forEach(el => {
      el.style.borderColor = '';
    });
  }

  return {
    validateEmail,
    validatePhone,
    validateName,
    validateText,
    validateNumber,
    validateAddress,
    validateRequired,
    validateForm,
    showFieldError,
    clearFieldError,
    clearAllErrors,
    PATTERNS,
    MAX_TEXT_LENGTH,
    MAX_NAME_LENGTH,
    MAX_ADDRESS_LENGTH,
  };
})();
