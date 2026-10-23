// Minimal inline Markdown support for the plan: **bold** and [text](url). Pure — no DOM.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function renderInline(md) {
  return escapeHtml(md)
    .replace(LINK_RE, (_, text, url) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function stripInline(md) {
  return md.replace(LINK_RE, '$1').replace(/\*\*/g, '');
}

export function extractLinks(md) {
  return [...md.matchAll(LINK_RE)].map((m) => ({ text: m[1], url: m[2] }));
}
