// Shared helpers for the country-page tab charts (Supply, Market, …) — kept
// in their own file rather than exported from a tab component so components
// stay Fast-Refresh-friendly (a file mixing component + non-component
// exports breaks Vite's fast refresh for that file). For the same reason this
// file exports no components: source attribution lives in ../ChartCaption,
// which the region pages use too, and tabs import it from there directly.

export function downloadBlob(content, filename, type = 'application/octet-stream') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
