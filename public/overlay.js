const root = document.getElementById('overlayRoot');
const lines = [];
const MAX_LINES = 3;

if (window.overlayAPI) {
  window.overlayAPI.onSubtitle((text) => {
    const normalized = String(text || '').trim();
    if (!normalized) return;

    lines.push(normalized);
    while (lines.length > MAX_LINES) {
      lines.shift();
    }
    render();
  });

  window.overlayAPI.onClear(() => {
    lines.length = 0;
    render();
  });

  window.overlayAPI.onStyle((style) => {
    applyStyle(style);
  });
}

function render() {
  root.innerHTML = '';
  for (const line of lines) {
    const el = document.createElement('div');
    el.className = 'subtitle-line';
    el.textContent = line;
    root.appendChild(el);
  }
}

function applyStyle(style) {
  if (!style || typeof style !== 'object') return;

  const rootStyle = document.documentElement.style;
  if (style.textColor) rootStyle.setProperty('--subtitle-text-color', style.textColor);
  if (style.bgColor && Number.isFinite(Number(style.bgOpacity))) {
    rootStyle.setProperty('--subtitle-bg-rgba', hexToRgba(style.bgColor, Number(style.bgOpacity)));
  }
  if (Number.isFinite(Number(style.fontSize))) {
    rootStyle.setProperty('--subtitle-font-size-px', `${Math.round(Number(style.fontSize))}px`);
  }
  if (Number.isFinite(Number(style.bottom))) {
    rootStyle.setProperty('--subtitle-bottom-px', `${Math.round(Number(style.bottom))}px`);
  }
  if (Number.isFinite(Number(style.radius))) {
    rootStyle.setProperty('--subtitle-radius-px', `${Math.round(Number(style.radius))}px`);
  }
}

function hexToRgba(hex, alpha) {
  const text = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
    return 'rgba(0, 0, 0, 0.780)';
  }
  const r = Number.parseInt(text.slice(1, 3), 16);
  const g = Number.parseInt(text.slice(3, 5), 16);
  const b = Number.parseInt(text.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, Number(alpha) || 0.78));
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
