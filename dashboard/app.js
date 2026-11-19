// Token Launch Radar — the dashboard's script. Reads window.RADAR (written by main.ts
// into data.js), renders the board, the detail view and the live-token table, and filters
// and sorts the board in the page. No network: every value comes from the snapshot.

(function () {
  var data = window.RADAR;
  var rows = data.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var qEl = $('q'), catEl = $('cat'), chainEl = $('chain'), sortEl = $('sort'), watchEl = $('watch');
  var rowsEl = $('rows'), countEl = $('count'), detailEl = $('detail');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** $2.75B, $512.4M, $45.2K, $123. */
  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function pctClass(n) {
    if (n === null || n === undefined) return '';
    return n >= 0 ? 'up' : 'down';
  }

  /** Fill a select with the distinct values of a field, in alphabetical order. */
  function fillSelect(el, values) {
    var seen = {};
    values.forEach(function (v) { if (v) seen[v] = true; });
    Object.keys(seen).sort().forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  fillSelect(catEl, rows.map(function (r) { return r.category; }));
  fillSelect(chainEl, rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []));

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value;
    var chain = chainEl.value;
    var watchOnly = watchEl.checked;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var sort = sortEl.value;
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    };
    return out.slice().sort(by[sort] || by.implied);
  }

  function renderBoard() {
    var list = filtered();
    countEl.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' pre-token protocols';
    if (list.length === 0) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">Nothing matches this filter. Clear the search or pick another category.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(function (r) {
      var tags = r.chains.slice(0, 3).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('');
      var watch = r.watchlist ? ' <span class="tag watch-tag">watchlist</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="slug">' + esc(r.slug) + '</span>' + watch + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + tags + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num value">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td><span class="tag">Farm plan &rsaquo;</span></td>' +
        '</tr>';
    }).join('');
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var base = fmtUsd(r.tvl_usd) + ' TVL &times; ' + r.category_multiple + ' (' + esc(r.multiple_source) + ')';
    detailEl.innerHTML =
      '<button class="close" id="detail-close" type="button">Close</button>' +
      '<h2>#' + r.rank + ' &middot; ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'no category') + ' &middot; ' +
      r.chains.map(esc).join(', ') + (r.watchlist ? ' &middot; on the watchlist' : '') + '</p>' +
      '<div class="facts">' +
      '<span><b>Implied value</b>' + fmtUsd(r.implied_value_usd) + '</span>' +
      '<span><b>TVL</b>' + fmtUsd(r.tvl_usd) + '</span>' +
      '<span><b>7-day change</b>' + fmtPct(r.change_7d) + '</span>' +
      '<span><b>Age</b>' + fmtAge(r.age_days) + '</span>' +
      '</div>' +
      '<h3>How the value is built</h3>' +
      '<p>' + base + ' &times; ' + r.growth_multiplier.toFixed(2) + ' growth &times; ' +
      r.maturity_multiplier.toFixed(2) + ' maturity = <strong>' + fmtUsd(r.implied_value_usd) + '</strong>. ' +
      'The record carries no token, so the value is the radar&rsquo;s claim about a token that does not exist yet.</p>' +
      '<h3>Farm plan</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    $('detail-close').addEventListener('click', function () {
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      history.replaceState(null, '', location.pathname);
      markOpen(null);
    });
    detailEl.scrollIntoView({ block: 'nearest' });
    markOpen(slug);
  }

  function markOpen(slug) {
    Array.prototype.forEach.call(rowsEl.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.classList.toggle('open', tr.getAttribute('data-slug') === slug);
    });
  }

  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    var slug = tr.getAttribute('data-slug');
    history.replaceState(null, '', '#' + slug);
    renderDetail(slug);
  });

  [qEl, catEl, chainEl, sortEl, watchEl].forEach(function (el) {
    el.addEventListener('input', renderBoard);
    el.addEventListener('change', renderBoard);
  });

  /** The live-token table: the market's own values, never the model's. */
  $('live-rows').innerHTML = data.live.map(function (p) {
    var ratio = p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + 'x' : '—';
    return '<tr>' +
      '<td><strong>' + esc(p.name) + '</strong><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td>' + p.chains.slice(0, 3).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') + '</td>' +
      '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd ? fmtUsd(p.mcap_usd) : '—') + '</td>' +
      '<td class="num">' + ratio + '</td>' +
      '</tr>';
  }).join('');

  $('meta').textContent = data.board_size + ' pre-token protocols ranked · ' + data.watchlist_size +
    ' on the watchlist · ' + data.live_size + ' live tokens set aside · model ' + data.model_version;
  $('asof').textContent = data.as_of;

  renderBoard();
  if (location.hash.length > 1) renderDetail(location.hash.slice(1));
})();
