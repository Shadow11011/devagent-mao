// Zero-dependency local embedder for OKF similarity.
//
// This is deliberately NOT a semantic model. It is a deterministic character
// n-gram + word-hash projection used to (a) make the OKF store testable without
// native deps and (b) give near-duplicate detection (dedup > 0.9) something to
// measure. The seam is injectable: pass a real embedder (ONNX bge-m3 int8 or
// similar) into createOkf later without touching store/recall/refine.

export function hashToken(token) {
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function charNgrams(text, n = 3) {
  const t = String(text ?? '').toLowerCase();
  const grams = [];
  for (let i = 0; i + n <= t.length; i++) grams.push(t.slice(i, i + n));
  return grams;
}

export function embedText(text, dims = 256) {
  const v = new Array(dims).fill(0);
  const grams = charNgrams(text, 3);
  for (const g of grams) v[hashToken(g) % dims] += 1;
  for (const w of String(text ?? '').toLowerCase().split(/\W+/).filter(Boolean)) {
    v[hashToken(w) % dims] += 2; // words carry more signal than raw n-grams
  }
  return normalize(v);
}

export function normalize(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const mag = Math.sqrt(sum);
  if (mag === 0) return v.slice();
  return v.map((x) => x / mag);
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function defaultEmbedFn(dims = 256) {
  return (text) => embedText(text, dims);
}
