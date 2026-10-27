/**
 * lib/news.js
 * Fetcher + parser berita via Google News RSS.
 * Semua sumber berita utama (Detik, Kompas, CNN Indonesia, Tempo, dll.)
 * sudah tercakup karena Google News mengagregasinya.
 */

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
});

// Konfigurasi bahasa/wilayah yang didukung
const LANGS = {
  id: { label: 'Indonesia', hl: 'id', gl: 'ID', ceid: 'ID:id' },
  en: { label: 'English (US)', hl: 'en-US', gl: 'US', ceid: 'US:en' },
};

/**
 * Membangun ekspresi pencarian Google News dari parameter mentah.
 * — exact: bungkus kata kunci dengan tanda kutip ("frasa tepat"),
 *   kecuali query sudah berisi operator (tanda kutip, site:, OR, dsb).
 * — range: 1d | 7d | 30d | 1y | '' (semua waktu)
 * — after/before: YYYY-MM-DD khusus rentang kustom
 */
function buildQuery(rawQ, { exact = true, range = '', after = '', before = '' } = {}) {
  let q = String(rawQ || '').trim();
  if (!q) return '';

  const hasOperator = /["']|site:|OR\b|-|allin|intitle:|inurl:|before:|after:|when:/i.test(q);
  if (exact && !hasOperator) {
    q = `"${q}"`;
  }

  if (range === '1d' || range === '7d' || range === '30d' || range === '1y') {
    q += ` when:${range}`;
  } else if (range === 'custom') {
    // Google: after = inklusif, before = eksklusif → geser before +1 hari agar tanggal akhir ikut
    if (after) q += ` after:${after}`;
    if (before) {
      const d = new Date(`${before}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      q += ` before:${d.toISOString().slice(0, 10)}`;
    }
  }
  return q;
}

function buildRssUrl(query, lang = 'id') {
  const l = LANGS[lang] || LANGS.id;
  const url =
    'https://news.google.com/rss/search' +
    `?q=${encodeURIComponent(query)}&hl=${l.hl}&gl=${l.gl}&ceid=${l.ceid}`;
  return url;
}

/**
 * Link dari Google News berbentuk redirect (…/rss/articles/CBMi…).
 * Bagian base64 biasanya menyimpan URL asli — coba decode; jika gagal,
 * kembalikan link google (tetap berfungsi, hanya redirect).
 */
function resolveGoogleLink(link) {
  const m = String(link).match(/\/articles\/([^?/]+)/);
  if (!m) return link;
  try {
    const decoded = Buffer.from(
      m[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    const hit = decoded.match(/https?:\/\/[^\s"\x00-\x1f\x7f]+/);
    if (hit) return hit[0];
  } catch {
    /* fallback di bawah */
  }
  return link;
}

/** Judul RSS berformat "Berita - Penerbit" → buang bagian penerbit. */
function cleanTitle(title, sourceName) {
  let t = String(title || '');
  if (sourceName) {
    const suffix = ` - ${sourceName}`;
    if (t.endsWith(suffix)) return t.slice(0, -suffix.length).trim();
  }
  // fallback: potong segmen terakhir jika masih ada " - "
  const idx = t.lastIndexOf(' - ');
  if (idx > 0) t = t.slice(0, idx);
  return t.trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ambil nama + url penerbit dari elemen <source> (bisa string / objek). */
function extractSource(el) {
  if (!el) return { name: '', url: '' };
  if (typeof el === 'string') return { name: stripHtml(el), url: '' };
  if (Array.isArray(el)) el = el.find((s) => s && s['#text']) || el[0] || {};
  if (typeof el === 'object') {
    return { name: stripHtml(el['#text'] || ''), url: el['@_url'] || '' };
  }
  return { name: '', url: '' };
}

/**
 * Pencarian utama.
 * @param {object} params { q, exact, range, after, before, lang, sort }
 * @returns {object} { query, lang, results, total }
 */
async function searchNews(params = {}) {
  const { q: rawQ, exact, range, after, before, lang = 'id', sort = 'relevance' } = params;

  const query = buildQuery(rawQ, { exact, range, after, before });
  if (!query) throw new Error('Kata kunci kosong');

  const url = buildRssUrl(query, lang);
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`Google News merespons ${res.status}`);
  const xml = await res.text();

  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel) throw new Error('Format RSS tidak dikenali');

  let items = channel.item || [];
  if (!Array.isArray(items)) items = [items];

  const seen = new Set();
  const results = [];

  for (const it of items) {
    const src = extractSource(it.source);
    const title = cleanTitle(it.title, src.name);
    const googleUrl = String(it.link || '');
    const realUrl = resolveGoogleLink(googleUrl);

    // dedupe: judul ternormalisasi
    const key = title.toLowerCase().replace(/\s+/g, ' ');
    if (!title || seen.has(key)) continue;
    seen.add(key);

    const published = it.pubDate ? new Date(it.pubDate) : null;

    // Deskripsi RSS biasanya hanya berupa "judul — penerbit" —
    // tampilkan sebagai snippet hanya jika benar-benar informatif.
    let snippet = stripHtml(it.description || '');
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const normTitle = norm(title);
    const isRedundant =
      !snippet ||
      norm(snippet) === normTitle ||
      norm(snippet) === norm(title + ' ' + src.name) ||
      norm(snippet) === norm(src.name) ||
      (src.name && snippet.toLowerCase() === src.name.toLowerCase());
    if (isRedundant) snippet = '';
    if (snippet.length < 40) snippet = '';
    if (snippet.length > 220) snippet = snippet.slice(0, 217) + '…';

    results.push({
      title,
      source: src.name || 'Tidak diketahui',
      sourceUrl: src.url,
      url: realUrl !== googleUrl ? realUrl : googleUrl,
      googleUrl,
      publishedAt: published && !Number.isNaN(published.valueOf()) ? published.toISOString() : null,
      snippet,
    });
  }

  if (sort === 'newest') {
    results.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  } else if (sort === 'oldest') {
    results.sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || ''));
  }
  // sort === 'relevance' → pertahankan urutan dari Google

  return { query, lang, results, total: results.length };
}

module.exports = { searchNews, buildQuery, LANGS };
