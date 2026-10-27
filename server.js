/**
 * server.js — Cari Berita
 * API:
 *   GET  /api/search?q=…&exact=1&range=…&after=…&before=…&lang=id&sort=relevance
 *   GET  /api/history                  → daftar riwayat (baru dulu)
 *   DELETE /api/history/:id            → hapus satu entri
 *   DELETE /api/history                → bersihkan semua
 *   POST /api/export                   → { format:'csv'|'xlsx', search, rows } → file unduhan
 *   GET  /api/langs                    → daftar bahasa/wilayah yang didukung
 * Aplikasi web disajikan dari folder /public.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { searchNews, LANGS } = require('./lib/news');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Riwayat pencarian (file JSON sederhana) ----------

const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_MAX = 100;

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, HISTORY_MAX), null, 2));
}

/** Simpan pencarian otomatis; entri duplikat (kata kunci + opsi sama) dipindah ke atas. */
function recordSearch({ q, exact, range, after, before, lang, count }) {
  if (!q || !String(q).trim()) return;
  const list = loadHistory();
  const now = Date.now();
  const entry = {
    id: `s${now}`,
    q: String(q).trim(),
    exact: !!exact,
    range: range || '',
    after: after || '',
    before: before || '',
    lang: lang || 'id',
    count: count ?? null,
    ts: now,
  };
  const dupIdx = list.findIndex(
    (e) =>
      e.q === entry.q &&
      !!e.exact === entry.exact &&
      (e.range || '') === entry.range &&
      (e.after || '') === entry.after &&
      (e.before || '') === entry.before &&
      (e.lang || 'id') === entry.lang
  );
  if (dupIdx !== -1) {
    const [dup] = list.splice(dupIdx, 1);
    entry.id = dup.id;
    entry.count = entry.count ?? dup.count;
  }
  list.unshift(entry);
  saveHistory(list);
}

// ---------- API ----------

app.get('/api/langs', (_req, res) => {
  res.json(Object.entries(LANGS).map(([value, v]) => ({ value, label: v.label })));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_KEYWORDS = 8;      // batas aman jumlah kata kunci per pencarian
const KEYWORD_DELAY_MS = 700; // jeda antar-permintaan agar Google tidak memblokir

app.get('/api/search', async (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'Masukkan kata kunci pencarian.' });
  }

  // Kata kunci dipisah koma → beberapa pencarian terpisah yang hasilnya digabung.
  const keywords = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_KEYWORDS);
  if (!keywords.length) {
    return res.status(400).json({ error: 'Masukkan kata kunci pencarian.' });
  }

  const opts = {
    exact: req.query.exact !== '0', // default: frasa tepat aktif
    range: req.query.range || '',
    after: req.query.after || '',
    before: req.query.before || '',
    lang: req.query.lang || 'id',
    sort: ['relevance', 'newest', 'oldest'].includes(req.query.sort) ? req.query.sort : 'relevance',
  };

  try {
    const all = [];
    for (let i = 0; i < keywords.length; i++) {
      const data = await searchNews({ ...opts, q: keywords[i] });
      for (const r of data.results) all.push({ ...r, keywords: [keywords[i]] });
      if (i < keywords.length - 1) await sleep(KEYWORD_DELAY_MS);
    }

    // Gabungkan: artikel yang sama ditemukan beberapa kata kunci tidak diduplikasi.
    const map = new Map();
    for (const r of all) {
      const key = r.title.toLowerCase().replace(/\s+/g, ' ');
      const existing = map.get(key);
      if (existing) {
        if (!existing.keywords.includes(r.keywords[0])) existing.keywords.push(r.keywords[0]);
      } else {
        map.set(key, r);
      }
    }
    const results = [...map.values()];

    if (opts.sort === 'newest') {
      results.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    } else if (opts.sort === 'oldest') {
      results.sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || ''));
    }

    const perKeyword = keywords.map((k) => ({
      keyword: k,
      total: all.filter((r) => r.keywords.includes(k)).length,
    }));

    recordSearch({
      q: keywords.join(', '),
      exact: opts.exact,
      range: opts.range,
      after: opts.after,
      before: opts.before,
      lang: opts.lang,
      count: results.length,
    });

    res.json({ query: keywords.join(', '), keywords, results, total: results.length, perKeyword });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(502).json({ error: `Gagal mengambil berita: ${err.message}` });
  }
});

app.get('/api/history', (_req, res) => {
  res.json(loadHistory());
});

app.delete('/api/history', (_req, res) => {
  saveHistory([]);
  res.json({ ok: true });
});

app.delete('/api/history/:id', (req, res) => {
  const { id } = req.params;
  const list = loadHistory().filter((e) => e.id !== id);
  saveHistory(list);
  res.json({ ok: true });
});

// ---------- Export CSV / XLSX ----------

app.post('/api/export', (req, res) => {
  const {
    format = 'csv',
    search = {},
    rows = [],
  } = req.body || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Tidak ada baris untuk diekspor.' });
  }

  const header = [
    'No', 'Judul', 'Sumber', 'Tanggal', 'Waktu (UTC)',
    'Link Berita', 'Link Google News', 'Snippet',
  ];
  const data = rows.map((r, i) => [
    i + 1,
    r.title || '',
    r.source || '',
    r.publishedAt ? r.publishedAt.slice(0, 10) : '',
    r.publishedAt ? r.publishedAt.slice(11, 19) : '',
    r.url || '',
    r.googleUrl || r.url || '',
    r.snippet || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = [4, 60, 18, 12, 11, 70, 70, 50].map((wch) => ({ wch }));

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const kwPart = (search.q || 'berita').replace(/[^\w\u00C0-\u024F-]+/g, '_').slice(0, 24);
  const base = `cari-berita_${kwPart}_${stamp}`;

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Berita');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(buf);
  }

  // CSV (dengan BOM agar Excel membaca UTF-8 dengan benar)
  const csv = XLSX.utils.sheet_to_csv(ws);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
  res.send('\uFEFF' + csv);
});

// ---------- Start ----------

app.listen(PORT, () => {
  console.log(`\n📰 Cari Berita berjalan di http://localhost:${PORT}\n`);
});
