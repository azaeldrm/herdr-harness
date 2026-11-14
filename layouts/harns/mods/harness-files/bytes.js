// Pure byte helpers (no herdr imports), so tests/markdown.mjs can load them in node.

export function hashBytes(b) {
  // A short digest of bytes (djb2), naming a cached image by its content.
  let h = 5381;
  for (let i = 0; i < b.length; i++) h = ((h << 5) + h + b[i]) | 0;
  return (h >>> 0).toString(36) + b.length.toString(36);
}

const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

function svgSize(b) {
  const head = ascii(b, 0, Math.min(b.length, 8192)), tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const num = name => {
    const m = new RegExp(String.raw`\b${name}\s*=\s*["']?\s*([\d.]+)(px)?\s*["'\s>/]`, "i").exec(tag);
    return m ? parseFloat(m[1]) : null;
  };
  const box = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  let w = num("width"), h = num("height");
  if (box) {
    const bw = parseFloat(box[1]), bh = parseFloat(box[2]);
    if (!w && !h) { w = bw; h = bh; } else if (!h && bw) h = w * bh / bw; else if (!w && bh) w = h * bw / bh;
  }
  return { type: "svg", width: w || 300, height: h || 150 };
}

export function sniff(b) {
  // An image's type and pixel size from its first bytes: png, jpg, gif, webp or svg; null otherwise.
  if (!b || b.length < 12) return b?.length ? svgSize(b) : null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b.length >= 24) return { type: "png", width: be32(b, 16), height: be32(b, 20) };
  if (ascii(b, 0, 3) === "GIF") return { type: "gif", width: le16(b, 6), height: le16(b, 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { type: "jpg", width: be16(b, i + 7), height: be16(b, i + 5) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + be16(b, i + 2);
    }
    return { type: "jpg", width: 0, height: 0 };
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { type: "webp", width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (chunk === "VP8L") return { type: "webp", width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (chunk === "VP8X") return { type: "webp", width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
    return null;
  }
  return svgSize(b);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// herdr's Buffer encodes bytes to base64 as an empty string, so this does it: three bytes to four characters,
// joined a chunk at a time (one long concatenation is slow in herdr's engine).
export function toBase64(bytes) {
  const n = bytes.length, chunks = [];
  let out = "";
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < n ? B64[((b & 15) << 2) | (c >> 6)] : "=") + (i + 2 < n ? B64[c & 63] : "=");
    if (out.length >= 16384) { chunks.push(out); out = ""; }
  }
  chunks.push(out);
  return chunks.join("");
}
