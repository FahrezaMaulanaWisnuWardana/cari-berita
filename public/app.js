/** app.js — logika frontend Cari Berita */

// ---------- Elemen ----------
const $ = (id) => document.getElementById(id);

const form = $('search-form');
const qInput = $('q');
const langSel = $('lang');
const rangeSel = $('range');
const customRange = $('custom-range');
const afterInput = $('after');
const beforeInput = $('before');
const exactChk = $('exact');
const sortSel = $('sort');
const searchBtn = $('search-btn');

const filterBar = $('filter-bar');
const resultCount = $('result-count');
const sourceChips = $('source-chips');
const refineFrom = $('refine-from');
const refineTo = $('refine-to');
const refineReset = $('refine-reset');
const exportCsv = $('export-csv');
const exportXlsx = $('export-xlsx');

const statusEl = $('status');
const resultsEl = $('results');
const emptyState = $('empty-state');

const historyList = $('history-list');
const clearHistory = $('clear-history');

// ---------- State ----------
let allResults = [];          // hasil dari server
let selectedSources = new Set(); // sumber yang ingin ditampilkan
let lastSearchParams = null;  // untuk label export

// ---------- Util ----------
function setStatus(type, msg) {
  if (!msg) {
    statusEl.hidden = true;
    statusEl.innerHTML = '';
    return;
  }
  statusEl.hidden = false;
  statusEl.className = 'status ' + type;
  statusEl.innerHTML = type === 'loading' ? '<span class="spin">⏳</span> ' + msg : msg;
}

function fmtDate(iso) {
  if (!iso) return 'tanpa tanggal';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute');
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return rtf.format(-hrs, 'hour');
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(-months, 'month');
  return rtf.format(-Math.round(months / 12), 'year');
}

function formatDateMeta(iso) {
  if (!iso) return 'tanpa tanggal';
  return `${relTime(iso)} · ${fmtDate(iso)}`;
}

// ---------- Hasil: filter & render ----------

function visibleResults() {
  const from = refineFrom.value ? new Date(refineFrom.value + 'T00:00:00') : null;
  const to = refineTo.value ? new Date(refineTo.value + 'T23:59:59') : null;

  return allResults.filter((r) => {
    if (!selectedSources.has(r.source)) return false;
    if (!r.publishedAt) return true; // item tanpa tanggal selalu tampil
    const d = new Date(r.publishedAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function renderResults() {
  const rows = visibleResults();

  resultCount.textContent = rows.length
    ? `${rows.length} berita ditampilkan dari ${allResults.length} total`
    : 'Tidak ada hasil yang cocok dengan filter';

  resultsEl.innerHTML = '';

  if (!rows.length) {
    if (allResults.length) {
      resultsEl.innerHTML =
        '<div class="card" style="text-align:center;color:#6b7686">Coba aktifkan kembali beberapa sumber atau ubah filter tanggal.</div>';
    }
    return;
  }

  for (const r of rows) {
    const card = document.createElement('article');
    card.className = 'card';

    const srcHtml = r.sourceUrl
      ? `<a href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener">${fmtSource(r.source)}</a>`
      : fmtSource(r.source);

    card.innerHTML = `
      <div class="card-top">
        <span class="card-source">${srcHtml}</span>
        <span class="card-date" title="${r.publishedAt || ''}">${relTime(r.publishedAt)} · ${fmtDate(r.publishedAt)}</span>
      </div>
      ${kwBadge(r)}
      <h3 class="card-title"><a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${fmtTitle(r.title)}</a></h3>
      ${r.snippet ? `<p class="card-snippet">${fmtSnippet(r.snippet)}</p>` : ''}
    `;
    resultsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
const escapeAttr = escapeHtml;
const fmtTitle = escapeHtml;
const fmtSnippet = escapeHtml;
const fmtSource = escapeHtml;

/** Badge kata kunci pembuatnya (khusus pencarian banyak kata kunci). */
function kwBadge(r) {
  const multiSearch = (lastSearchParams?.q || '').includes(',');
  if (!multiSearch && (!r.keywords || r.keywords.length <= 1)) {
    // pencarian satu kata kunci → tidak perlu badge
    return '';
  }
  if (!r.keywords || !r.keywords.length) return '';
  const shown = r.keywords.slice(0, 2).join(' · ');
  const extra = r.keywords.length > 2 ? ` +${r.keywords.length - 2}` : '';
  return `<span class="card-keyword" title="${escapeAttr(r.keywords.join(' · '))}">🔍 ${fmtSource(shown)}${extra}</span>`;
}

function renderSourceChips() {
  const counts = new Map();
  for (const r of allResults) counts.set(r.source, (counts.get(r.source) || 0) + 1);

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  sourceChips.innerHTML = '';
  for (const [src, n] of sorted) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (selectedSources.has(src) ? ' on' : '');
    chip.textContent = `${src} (${n})`;
    chip.title = 'Klik untuk menampilkan/menyembunyikan sumber ini';
    chip.onclick = () => {
      if (selectedSources.has(src)) selectedSources.delete(src);
      else selectedSources.add(src);
      renderSourceChips();
      renderResults();
    };
    sourceChips.appendChild(chip);
  }
}

// ---------- Pencarian ----------

function currentSearchParams() {
  return {
    q: qInput.value.trim(),
    exact: exactChk.checked ? '1' : '0',
    range: rangeSel.value,
    after: afterInput.value,
    before: beforeInput.value,
    lang: langSel.value,
    sort: sortSel.value,
  };
}

async function runSearch(params) {
  if (!params.q) return;

  const url = new URL('/api/search', location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v != null) url.searchParams.set(k, v);
  }

  searchBtn.disabled = true;
  setStatus('loading', `Mencari berita “${params.q}”…`);
  emptyState.hidden = true;
  resultsEl.innerHTML = '';

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');

    // simpan urutan asli (relevansi) agar sort"relevance" bisa dipulihkan
    allResults = (data.results || []).map((r, i) => ({ ...r, _order: i }));
    lastSearchParams = params;

    selectedSources = new Set(allResults.map((r) => r.source));

    filterBar.hidden = allResults.length === 0;
    refineFrom.value = '';
    refineTo.value = '';

    renderSourceChips();

    setStatus(
      null,
      null
    );
    if (!allResults.length) {
      setStatus('error', `Tidak ditemukan berita untuk kata kunci “${params.q}”. Coba kata kunci lain atau perlebar periode.`);
    }
    renderResults();
    loadHistory();
  } catch (err) {
    setStatus('error', escapeHtml(err.message));
  } finally {
    searchBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(currentSearchParams());
});

// ---------- Sort ulang (client-side, tanpa fetch ulang) ----------

sortSel.addEventListener('change', () => {
  const mode = sortSel.value;
  if (mode === 'newest') {
    allResults.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  } else if (mode === 'oldest') {
    allResults.sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || ''));
  } else {
    allResults.sort((a, b) => a._order - b._order);
  }
  renderResults();
});

// ---------- Filter tanggal client-side ----------

[refineFrom, refineTo].forEach((el) => el.addEventListener('change', renderResults));
refineReset.addEventListener('click', () => {
  refineFrom.value = '';
  refineTo.value = '';
  renderResults();
});

// ---------- Rentang kustom ----------

rangeSel.addEventListener('change', () => {
  customRange.hidden = rangeSel.value !== 'custom';
});

// ---------- Export ----------

async function doExport(format) {
  const rows = visibleResults();
  if (!rows.length) {
    setStatus('error', 'Tidak ada baris untuk diekspor.');
    return;
  }
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        search: { q: lastSearchParams?.q || qInput.value.trim() },
        rows,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Export gagal');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `cari-berita.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    setStatus('error', escapeHtml(err.message));
  }
}

exportCsv.addEventListener('click', () => doExport('csv'));
exportXlsx.addEventListener('click', () => doExport('xlsx'));

// ---------- Riwayat ----------

const RANGE_LABELS = {
  '': 'semua waktu', '1d': '24 jam', '7d': '7 hari',
  '30d': '30 hari', '1y': '1 tahun', custom: 'kustom',
};

async function loadHistory() {
  try {
    const list = await (await fetch('/api/history')).json();
    historyList.innerHTML = '';
    if (!list.length) {
      historyList.innerHTML = '<li class="history-empty">Belum ada pencarian.</li>';
      return;
    }
    for (const e of list) {
      const li = document.createElement('li');
      li.className = 'history-item';
      const d = new Date(e.ts);
      li.innerHTML = `
        <div class="h-main">
          <div class="h-q">${escapeHtml(e.q)}</div>
          <div class="h-meta">
            ${RANGE_LABELS[e.range || ''] || 'kustom'} · ${e.exact ? 'frasa tepat' : 'luas'} · ${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
          </div>
        </div>
        <button class="h-del" title="Hapus dari riwayat">✕</button>
      `;
      li.querySelector('.h-main').onclick = () => {
        qInput.value = e.q;
        exactChk.checked = !!e.exact;
        rangeSel.value = e.range || '';
        rangeSel.dispatchEvent(new Event('change'));
        afterInput.value = e.after || '';
        beforeInput.value = e.before || '';
        sortSel.value = 'relevance';
        runSearch({
          q: e.q, exact: e.exact ? '1' : '0', range: e.range || '',
          after: e.after || '', before: e.before || '',
          lang: e.lang || 'id', sort: 'relevance',
        });
      };
      li.querySelector('.h-del').onclick = async (ev) => {
        ev.stopPropagation();
        await fetch(`/api/history/${e.id}`, { method: 'DELETE' });
        loadHistory();
      };
      historyList.appendChild(li);
    }
  } catch {
    /* riwayat gagal dimuat — abaikan */
  }
}

clearHistory.addEventListener('click', async () => {
  if (!confirm('Hapus semua riwayat pencarian?')) return;
  await fetch('/api/history', { method: 'DELETE' });
  loadHistory();
});

// ---------- Init ----------

(async function init() {
  // isi dropdown bahasa dari server
  try {
    const langs = await (await fetch('/api/langs')).json();
    for (const l of langs) {
      const opt = document.createElement('option');
      opt.value = l.value;
      opt.textContent = l.label;
      langSel.appendChild(opt);
    }
    langSel.value = 'id';
  } catch { /* fallback: dropdown tetap kosong */ }

  loadHistory();
})();
