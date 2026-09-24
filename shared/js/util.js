// Small browser helpers shared by all tools.

/** localStorage, or null when it is blocked (private mode, file://, …). */
export function safeStorage() {
  try {
    const s = window.localStorage;
    const k = '__3d_druck_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** File name without characters that trouble file systems. */
export function safeName(name, fallback = 'export') {
  return (name || fallback).replace(/[^\w\-äöüÄÖÜß]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
