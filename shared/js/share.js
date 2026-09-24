// Share links: the document is compressed into the URL hash (#m=… for the
// Muster-Generator, #t=… for the Text-Generator).

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Document -> URL hash fragment (without '#'). */
export async function encodeDoc(doc, key = 'm') {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream === 'function') {
    const packed = await pipe(json, new CompressionStream('deflate-raw'));
    return `${key}=z${toBase64Url(packed)}`;
  }
  return `${key}=j${toBase64Url(json)}`;
}

/** URL hash -> document (or null). */
export async function decodeHash(hash, key = 'm') {
  const m = new RegExp(`(?:^#?|&)${key}=([zj])([A-Za-z0-9_-]+)`).exec(hash || '');
  if (!m) return null;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
