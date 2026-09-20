// ============================================================
// 落雪在线歌单 — 歌单广场 (左面板 tab) + 歌单详情弹窗 + 搜索页歌单结果
// 服务端: /api/lx/songlist/{tags,square,search,detail}
// 播放整单: loadPlaylistIntoQueueById('lxsl:<source>:<id>') → 流式分页入队
// ============================================================
var SL_SOURCES = [
  { id: 'wy', name: '网易云' },
  { id: 'kw', name: '酷我' },
  { id: 'kg', name: '酷狗' },
  { id: 'tx', name: 'QQ' },
  { id: 'mg', name: '咪咕' },
];
var slSquareState = {
  source: 'wy',
  tagId: '',
  sortId: '',
  page: 1,
  lists: [],
  total: 0,
  hasMore: false,
  loading: false,
  tagsLoaded: {},
  tags: [],
  hot: [],
  sortList: [],
  keywords: '', // 非空 = 搜索态 (按歌手名/歌单名搜歌单)
  sortMode: 'default', // 结果展示排序 (对已加载结果)
};
// 歌单列表接口只有播放量/曲目数可用 (发布/更新时间各平台列表接口均不返回)
var SL_SORT_MODES = [
  { id: 'default', name: '平台默认' },
  { id: 'playDesc', name: '播放量 高→低' },
  { id: 'playAsc', name: '播放量 低→高' },
  { id: 'trackDesc', name: '曲目数 多→少' },
];
var slDetailState = null; // 弹窗: {source,id,page,tracks,total,info,loading,hasMore}
var slSearchState = { seq: 0, lists: [], page: 1, total: 0, hasMore: false, loading: false, query: '' };

function slEsc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function slSourceName(id) {
  var m = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕' };
  return m[id] || id;
}

function slPlayCountNum(s) {
  if (s == null) return 0;
  var t = String(s);
  var n = parseFloat(t);
  if (isNaN(n)) return 0;
  if (t.indexOf('亿') >= 0) return n * 1e8;
  if (t.indexOf('万') >= 0) return n * 1e4;
  return n;
}

function slSortedLists() {
  var st = slSquareState;
  if (st.sortMode === 'playDesc') return st.lists.slice().sort(function (a, b) { return slPlayCountNum(b.playCount) - slPlayCountNum(a.playCount); });
  if (st.sortMode === 'playAsc') return st.lists.slice().sort(function (a, b) { return slPlayCountNum(a.playCount) - slPlayCountNum(b.playCount); });
  if (st.sortMode === 'trackDesc') return st.lists.slice().sort(function (a, b) { return (b.trackCount || 0) - (a.trackCount || 0); });
  return st.lists;
}

function slDetailIdOf(source, id) {
  return 'lxsl:' + source + ':' + id;
}

// ---------- 歌单广场 (左面板) ----------
function slPaneNode() {
  return document.getElementById('songlist-pane');
}

function slSquareCardHtml(pl) {
  var thumb = pl.cover ? '<img src="' + slEsc(pl.cover) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">' : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
  return '<div class="sl-card" data-sl-source="' + pl.source + '" data-sl-id="' + slEsc(pl.id) + '" data-sl-name="' + slEsc(pl.name) + '">' +
    thumb +
    '<div style="flex:1;min-width:0"><div class="pl-name">' + slEsc(pl.name) + '<span class="tag-source ' + pl.source + '" style="margin-left:6px;vertical-align:1px">' + slSourceName(pl.source) + '</span></div>' +
    '<div class="pl-sub">' + slEsc(pl.author || '') + (pl.trackCount ? (' · ' + pl.trackCount + ' 首') : '') + (pl.playCount ? (' · ' + slEsc(String(pl.playCount)) + '次播放') : '') + '</div></div>' +
    '</div>';
}

function renderSongListSquarePane(opts) {
  opts = opts || {};
  var pane = slPaneNode();
  if (!pane) return;
  var st = slSquareState;
  var sourcePills = SL_SOURCES.map(function (s) {
    return '<button class="panel-tab' + (st.source === s.id ? ' active' : '') + '" onclick="slSetSource(\'' + s.id + '\')">' + s.name + '</button>';
  }).join('');
  var sortPills = (st.sortList || []).map(function (s) {
    return '<button class="fx-mini-btn' + (st.sortId === s.id ? '' : ' ghost') + '" style="height:22px;padding:0 8px;font-size:10.5px" onclick="slSetSort(\'' + slEsc(s.id) + '\')">' + slEsc(s.name) + '</button>';
  }).join('');
  var tagOptions = '<option value="">全部标签</option>' + (st.tags || []).map(function (group) {
    return '<optgroup label="' + slEsc(group.name) + '">' + (group.list || []).map(function (t) {
      return '<option value="' + slEsc(t.id) + '"' + (st.tagId === t.id ? ' selected' : '') + '>' + slEsc(t.name) + '</option>';
    }).join('') + '</optgroup>';
  }).join('');
  var hotPills = (st.hot || []).slice(0, 8).map(function (t) {
    return '<button class="fx-mini-btn ghost" style="height:22px;padding:0 8px;font-size:10.5px" onclick="slSetTag(\'' + slEsc(t.id) + '\')">' + slEsc(t.name) + '</button>';
  }).join('');
  var listHtml = st.lists.map(slSquareCardHtml).join('');
  var footer = st.loading
    ? '<div class="playlist-catalog-status"><span class="queue-hydration-spinner spinning"></span><span>正在载入...</span></div>'
    : (st.hasMore ? '<div class="local-playlist-footer"><button class="fx-mini-btn ghost" onclick="slLoadMore()">加载更多</button></div>' : '');
  var openRow = '<div class="sl-open-row">' +
    '<select id="sl-open-source" class="sl-select">' + SL_SOURCES.map(function (s) { return '<option value="' + s.id + '">' + s.name + '</option>'; }).join('') + '</select>' +
    '<input id="sl-open-input" class="sl-input" placeholder="粘贴歌单链接 / ID" autocomplete="off">' +
    '<button class="fx-mini-btn" style="flex:none" onclick="slOpenFromInput()">打开</button>' +
    '</div>';
  pane.innerHTML =
    '<div class="panel-tabs" style="margin-bottom:6px">' + sourcePills + '</div>' +
    openRow +
    '<div style="display:flex;gap:6px;align-items:center;margin:8px 0 4px;flex-wrap:wrap">' +
    '<select class="sl-select" style="flex:1" onchange="slSetTag(this.value)">' + tagOptions + '</select>' + sortPills +
    '</div>' +
    (hotPills ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' + hotPills + '</div>' : '') +
    '<div id="sl-list">' + (listHtml || (st.loading ? '' : '<div style="text-align:center;padding:18px 0;color:rgba(255,255,255,.32);font-size:11.5px">没有找到歌单</div>')) + '</div>' +
    footer;
  if (opts.preserveScroll) {
    var panel = document.getElementById('songlist-pane');
    if (panel && opts.scrollTop != null) panel.scrollTop = opts.scrollTop;
  }
}

function slBindCardClicks(container) {
  if (!container || container.__slBound) return;
  container.__slBound = true;
  container.addEventListener('click', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('[data-sl-id]') : null;
    if (!card) return;
    openSongListDetailModal(card.getAttribute('data-sl-source'), card.getAttribute('data-sl-id'), card.getAttribute('data-sl-name') || '');
  });
}

function slRefreshSquare(resetPage) {
  var st = slSquareState;
  if (st.loading) return;
  if (resetPage) st.page = 1;
  st.loading = true;
  renderSongListSquarePane({ preserveScroll: true, scrollTop: document.getElementById('songlist-pane') ? document.getElementById('songlist-pane').scrollTop : 0 });
  var url;
  if (st.keywords) {
    url = '/api/lx/songlist/search?source=' + st.source + '&keywords=' + encodeURIComponent(st.keywords) + '&page=' + st.page;
  } else {
    url = '/api/lx/songlist/square?source=' + st.source + '&page=' + st.page;
    if (st.tagId) url += '&tagId=' + encodeURIComponent(st.tagId);
    if (st.sortId) url += '&sortId=' + encodeURIComponent(st.sortId);
  }
  apiJson(url, { timeoutMs: 15000 }).then(function (r) {
    st.loading = false;
    if (!r || !r.success) {
      showToast('歌单广场加载失败: ' + ((r && r.error) || '未知错误'));
      renderSongListSquarePane();
      renderSlPlazaViews();
      return;
    }
    st.lists = resetPage ? (r.lists || []) : st.lists.concat(r.lists || []);
    st.total = Number(r.total) || st.lists.length;
    st.hasMore = !!r.hasMore;
    renderSongListSquarePane();
    renderSlPlazaViews();
  }).catch(function (e) {
    st.loading = false;
    showToast('歌单广场加载失败: ' + ((e && e.message) || '网络错误'));
    renderSongListSquarePane();
    renderSlPlazaViews();
  });
}

// 广场数据变化时同步渲染全屏页 (若打开)
function renderSlPlazaViews() {
  if (!isSongListPlazaOpen()) return;
  renderSlPlazaToolbar();
  renderSlPlazaGrid();
}

function slLoadTags() {
  var st = slSquareState;
  if (st.tagsLoaded[st.source]) {
    renderSongListSquarePane();
    renderSlPlazaViews();
    return;
  }
  renderSongListSquarePane();
  apiJson('/api/lx/songlist/tags?source=' + st.source, { timeoutMs: 15000 }).then(function (r) {
    st.tagsLoaded[st.source] = true;
    st.tags = (r && r.tags) || [];
    st.hot = (r && r.hot) || [];
    st.sortList = (r && r.sortList) || [];
    if (!st.sortId && st.sortList.length) st.sortId = st.sortList[0].id;
    renderSongListSquarePane();
    renderSlPlazaViews();
  }).catch(function () {
    st.tagsLoaded[st.source] = true;
    renderSongListSquarePane();
    renderSlPlazaViews();
  });
}

function slSetSource(source) {
  var st = slSquareState;
  if (st.source === source) return;
  st.source = source;
  st.tagId = '';
  st.sortId = '';
  st.lists = [];
  slLoadTags();
  slRefreshSquare(true);
}

function slSetTag(tagId) {
  slSquareState.tagId = tagId || '';
  slRefreshSquare(true);
}

function slSetSort(sortId) {
  slSquareState.sortId = sortId || '';
  slRefreshSquare(true);
}

function slLoadMore() {
  slSquareState.page += 1;
  slRefreshSquare(false);
}

function slOpenFromInput() {
  var sourceEl = null;
  var inputEl = null;
  var pairs = [['sl-plaza-open-source', 'sl-plaza-open-input'], ['sl-open-source', 'sl-open-input']];
  for (var i = 0; i < pairs.length; i++) {
    var s = document.getElementById(pairs[i][0]);
    var inp = document.getElementById(pairs[i][1]);
    if (s && inp && inp.offsetParent !== null) { sourceEl = s; inputEl = inp; break; }
  }
  if (!sourceEl || !inputEl) return;
  var text = inputEl.value.trim();
  if (!text) { showToast('先粘贴歌单链接或 ID'); return; }
  inputEl.value = '';
  if (isSongListPlazaOpen()) {
    slPlazaOpenDetail(sourceEl.value, text, '');
  } else {
    openSongListDetailModal(sourceEl.value, text, '');
  }
}

// ---------- 全屏音乐广场页 ----------
var slPlazaDetail = null; // {source,id,title,page,tracks,total,info,hasMore,loading}

function isSongListPlazaOpen() {
  var view = document.getElementById('songlist-plaza-view');
  return !!(view && view.style.display !== 'none');
}

function openSongListPlaza() {
  var view = document.getElementById('songlist-plaza-view');
  if (!view) return;
  view.style.display = '';
  document.body.classList.add('sl-plaza-open');
  slBindPlazaInfiniteScroll();
  slPlazaBack();
  if (!slSquareState.lists.length) {
    slLoadTags();
    slRefreshSquare(true);
  } else {
    renderSlPlazaToolbar();
    renderSlPlazaGrid();
  }
}

function closeSongListPlaza() {
  var view = document.getElementById('songlist-plaza-view');
  if (view) view.style.display = 'none';
  document.body.classList.remove('sl-plaza-open');
}

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (!isSongListPlazaOpen()) return;
  var panel = document.getElementById('sl-plaza-tag-panel');
  if (panel && panel.style.display !== 'none') { slCloseTagDrop(); return; }
  var sortPanel = document.getElementById('sl-plaza-sort-panel');
  if (sortPanel && sortPanel.style.display !== 'none') { slCloseSortDrop(); return; }
  if (slPlazaDetail) { slPlazaBack(); return; }
  closeSongListPlaza();
});

function renderSlPlazaToolbar() {
  var st = slSquareState;
  var toolbar = document.getElementById('sl-plaza-toolbar');
  if (!toolbar) return;
  var sourcePills = SL_SOURCES.map(function (s) {
    return '<button class="sl-chip' + (st.source === s.id ? ' active' : '') + '" onclick="slSetSource(\'' + s.id + '\')">' + s.name + '</button>';
  }).join('');
  var sortPills = (st.sortList || []).map(function (s) {
    return '<button class="sl-pill' + (st.sortId === s.id ? ' active' : '') + '" onclick="slSetSort(\'' + slEsc(s.id) + '\')">' + slEsc(s.name) + '</button>';
  }).join('');
  var tagLabel = '全部标签';
  (st.tags || []).forEach(function (group) {
    (group.list || []).forEach(function (t) {
      if (t.id === st.tagId) tagLabel = t.name;
    });
  });
  var tagPanel = '<button class="sl-tag-item' + (st.tagId ? '' : ' active') + '" onclick="slPickTag(\'\')">全部标签</button>' + (st.tags || []).map(function (group) {
    return '<div class="sl-tag-group"><div class="sl-tag-group-name">' + slEsc(group.name) + '</div>' +
      (group.list || []).map(function (t) {
        return '<button class="sl-tag-item' + (st.tagId === t.id ? ' active' : '') + '" onclick="slPickTag(\'' + slEsc(t.id) + '\')">' + slEsc(t.name) + '</button>';
      }).join('') + '</div>';
  }).join('');
  var hotPills = (st.hot || []).slice(0, 10).map(function (t) {
    return '<button class="sl-pill ghost' + (st.tagId === t.id ? ' active' : '') + '" onclick="slSetTag(\'' + slEsc(t.id) + '\')">' + slEsc(t.name) + '</button>';
  }).join('');
  var searching = !!st.keywords;
  var sortModeName = '平台默认';
  SL_SORT_MODES.forEach(function (m) { if (m.id === st.sortMode) sortModeName = m.name; });
  var sortDropHtml =
    '<div class="sl-tag-drop" id="sl-plaza-sort-drop">' +
    '<button class="sl-chip sl-tag-btn" id="sl-plaza-sort-btn" onclick="slToggleSortDrop(event)"><span>排序 · ' + slEsc(sortModeName) + '</span><i class="sl-tag-caret"></i></button>' +
    '<div class="sl-tag-panel" id="sl-plaza-sort-panel" style="display:none">' +
    SL_SORT_MODES.map(function (m) {
      return '<button class="sl-tag-item' + (st.sortMode === m.id ? ' active' : '') + '" onclick="slPickSort(\'' + m.id + '\')">' + slEsc(m.name) + '</button>';
    }).join('') +
    '<div class="sl-sort-note">对已加载的结果排序 · 向下滚动自动加载更多</div>' +
    '</div></div>';
  var searchRow =
    '<div class="sl-plaza-filter-row sl-plaza-search-row">' +
    '<input id="sl-plaza-search-input" class="sl-input sl-search-input" placeholder="搜索歌手名 / 歌单名" value="' + slEsc(st.keywords || '') + '" autocomplete="off" spellcheck="false" ' +
    'onkeydown="if(event.key===\'Enter\')slPlazaSearch()" onfocus="this.select()">' +
    '<button class="sl-btn-primary" onclick="slPlazaSearch()">' + (searching ? '重新搜索' : '搜索歌单') + '</button>' +
    (searching ? '<button class="sl-pill ghost" onclick="slPlazaClearSearch()">✕ 退出搜索</button>' : '') +
    '</div>';
  var filterRow = searching
    ? '<div class="sl-plaza-filter-row">' +
    '<div class="sl-plaza-search-hint">正在搜索 “' + slEsc(st.keywords) + '” 的歌单 · ' + (st.total || st.lists.length) + ' 个结果 · 切换上方平台可换源搜索</div>' + sortDropHtml +
    '</div>'
    : '<div class="sl-plaza-filter-row">' +
    '<div class="sl-tag-drop" id="sl-plaza-tag-drop">' +
    '<button class="sl-chip sl-tag-btn" id="sl-plaza-tag-btn" onclick="slToggleTagDrop(event)"><span>' + slEsc(tagLabel) + '</span><i class="sl-tag-caret"></i></button>' +
    '<div class="sl-tag-panel" id="sl-plaza-tag-panel" style="display:none">' + tagPanel + '</div>' +
    '</div>' + sortDropHtml + sortPills + hotPills +
    '</div>';
  toolbar.innerHTML =
    searchRow +
    '<div class="sl-plaza-chip-row">' + sourcePills + '</div>' +
    filterRow;
  // 侧栏同步刷新 (数据同源)
  renderSongListSquarePane();
}

function slPlazaSearch() {
  var input = document.getElementById('sl-plaza-search-input');
  var kw = input ? input.value.trim() : '';
  var st = slSquareState;
  if (kw && kw === st.keywords && st.lists.length) {
    renderSlPlazaToolbar();
    renderSlPlazaGrid();
    return;
  }
  st.keywords = kw;
  slRefreshSquare(true);
}

function slPlazaClearSearch() {
  slSquareState.keywords = '';
  slRefreshSquare(true);
}

function slToggleTagDrop(e) {
  if (e) e.stopPropagation();
  var panel = document.getElementById('sl-plaza-tag-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function slCloseTagDrop() {
  var panel = document.getElementById('sl-plaza-tag-panel');
  if (panel) panel.style.display = 'none';
}

function slPickTag(tagId) {
  slCloseTagDrop();
  slSetTag(tagId);
}

function slToggleSortDrop(e) {
  if (e) e.stopPropagation();
  var panel = document.getElementById('sl-plaza-sort-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function slCloseSortDrop() {
  var panel = document.getElementById('sl-plaza-sort-panel');
  if (panel) panel.style.display = 'none';
}

function slPickSort(mode) {
  slCloseSortDrop();
  slSquareState.sortMode = mode || 'default';
  renderSlPlazaToolbar();
  renderSlPlazaGrid();
}

document.addEventListener('click', function (e) {
  var drop = document.getElementById('sl-plaza-tag-drop');
  if (drop && drop.contains && !drop.contains(e.target)) slCloseTagDrop();
  var sortDrop = document.getElementById('sl-plaza-sort-drop');
  if (sortDrop && sortDrop.contains && !sortDrop.contains(e.target)) slCloseSortDrop();
});

function renderSlPlazaGrid() {
  var st = slSquareState;
  var grid = document.getElementById('sl-plaza-grid');
  var footer = document.getElementById('sl-plaza-footer');
  if (!grid) return;
  if (!st.lists.length) {
    grid.innerHTML = '<div class="sl-plaza-empty">' + (st.loading ? '正在载入...' : (st.keywords ? '没有找到与 “' + slEsc(st.keywords) + '” 相关的歌单，换个关键词或平台试试' : '没有找到歌单')) + '</div>';
    if (footer) footer.innerHTML = '';
    return;
  }
  grid.innerHTML = slSortedLists().map(function (pl) {
    var cover = pl.cover
      ? '<img class="sl-plaza-cover" src="' + slEsc(pl.cover) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.15">'
      : '<div class="sl-plaza-cover sl-plaza-cover-empty"></div>';
    return '<div class="sl-plaza-card" data-sl-source="' + pl.source + '" data-sl-id="' + slEsc(pl.id) + '" data-sl-name="' + slEsc(pl.name) + '">' +
      '<div class="sl-plaza-cover-wrap">' + cover +
      (pl.playCount ? '<span class="sl-plaza-playcount">▶ ' + slEsc(String(pl.playCount)) + '</span>' : '') +
      '</div>' +
      '<div class="sl-plaza-card-name">' + slEsc(pl.name) + '</div>' +
      '<div class="sl-plaza-card-sub">' + slEsc(slSourceName(pl.source)) + (pl.author ? (' · ' + slEsc(pl.author)) : '') + (pl.trackCount ? (' · ' + pl.trackCount + '首') : '') + '</div>' +
      '</div>';
  }).join('');
  if (footer) {
    footer.innerHTML = st.loading
      ? '<div class="playlist-catalog-status"><span class="queue-hydration-spinner spinning"></span><span>正在载入...</span></div>'
      : '';
  }
  grid.querySelectorAll('[data-sl-id]').forEach(function (card) {
    card.addEventListener('click', function () {
      slPlazaOpenDetail(card.getAttribute('data-sl-source'), card.getAttribute('data-sl-id'), card.getAttribute('data-sl-name') || '');
    });
  });
  setTimeout(slPlazaMaybeLoadMore, 80);
}

function slPlazaLoadMore() {
  slSquareState.page += 1;
  var st = slSquareState;
  st.loading = true;
  renderSlPlazaGrid();
  var url;
  if (st.keywords) {
    url = '/api/lx/songlist/search?source=' + st.source + '&keywords=' + encodeURIComponent(st.keywords) + '&page=' + st.page;
  } else {
    url = '/api/lx/songlist/square?source=' + st.source + '&page=' + st.page;
    if (st.tagId) url += '&tagId=' + encodeURIComponent(st.tagId);
    if (st.sortId) url += '&sortId=' + encodeURIComponent(st.sortId);
  }
  apiJson(url, { timeoutMs: 15000 }).then(function (r) {
    st.loading = false;
    st.lists = st.lists.concat((r && r.lists) || []);
    // 本页无新增 → 视为没有更多, 防止自动加载死循环
    st.hasMore = !!(r && r.hasMore) && (r && r.lists ? r.lists.length : 0) > 0;
    renderSlPlazaGrid();
  }).catch(function () {
    st.loading = false;
    renderSlPlazaGrid();
  });
}

// ---------- 无限滚动自动加载 ----------
function slPlazaMaybeLoadMore() {
  var view = document.getElementById('songlist-plaza-view');
  if (!view || !isSongListPlazaOpen()) return;
  if (slPlazaDetail) {
    if (slPlazaDetail.hasMore && !slPlazaDetail.loading &&
        view.scrollTop + view.clientHeight >= view.scrollHeight - 600) slPlazaDetailLoadMore();
    return;
  }
  var st = slSquareState;
  if (st.hasMore && !st.loading && st.lists.length &&
      view.scrollTop + view.clientHeight >= view.scrollHeight - 600) slPlazaLoadMore();
}

function slBindPlazaInfiniteScroll() {
  var view = document.getElementById('songlist-plaza-view');
  if (!view || view.__slInfScroll) return;
  view.__slInfScroll = true;
  view.addEventListener('scroll', function () {
    if (!isSongListPlazaOpen()) return;
    slPlazaMaybeLoadMore();
  });
}

function slPlazaOpenDetail(source, id, title) {
  // loading 初始必须为 false: slPlazaDetailLoadMore 的守卫会拦截 loading 状态
  slPlazaDetail = { source: source, id: id, title: title, page: 1, tracks: [], total: 0, info: null, hasMore: true, loading: false };
  var browse = document.getElementById('sl-plaza-browse');
  var detail = document.getElementById('sl-plaza-detail');
  if (browse) browse.style.display = 'none';
  if (detail) detail.style.display = '';
  renderSlPlazaDetail();
  slPlazaDetailLoadMore();
  // 常听歌单统计 (音乐广场歌单打开计数)
  if (typeof frequentPlaylistTrack === 'function') {
    frequentPlaylistTrack({ type: 'plaza', source: source, id: id, name: title || '' });
  }
}

function slPlazaBack() {
  slPlazaDetail = null;
  var browse = document.getElementById('sl-plaza-browse');
  var detail = document.getElementById('sl-plaza-detail');
  if (browse) browse.style.display = '';
  if (detail) detail.style.display = 'none';
}

function renderSlPlazaDetail() {
  var st = slPlazaDetail;
  var detail = document.getElementById('sl-plaza-detail');
  if (!st || !detail) return;
  var info = st.info || {};
  // 常听歌单: 封面到手后回填
  if (info.cover && typeof frequentPlaylistCoverUpdate === 'function') {
    frequentPlaylistCoverUpdate('plaza:' + st.source + ':' + st.id, info.cover);
  }
  var rows = st.tracks.map(function (song, i) {
    var thumb = song.cover
      ? '<img src="' + slEsc(song.cover) + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">'
      : '<div class="sl-track-thumb-empty"></div>';
    return '<div class="sl-track-row" data-sl-track="' + i + '">' +
      '<span class="sl-track-idx">' + (i + 1) + '</span><span class="sl-track-eq" aria-hidden="true"><i></i><i></i><i></i></span>' + thumb +
      '<div style="flex:1;min-width:0"><div class="pl-name" style="font-size:12.5px">' + slEsc(song.name) + '</div>' +
      '<div class="pl-sub">' + slEsc(song.artist || '') + (song.album ? (' · ' + slEsc(song.album)) : '') + '</div></div>' +
      '<span class="tag-source ' + song.provider + '" style="flex:none">' + slSourceName(song.lxSource || song.provider) + '</span>' +
      '</div>';
  }).join('');
  var footer = st.loading
    ? '<div class="playlist-catalog-status" style="margin-top:10px"><span class="queue-hydration-spinner spinning"></span><span>正在载入歌曲...</span></div>'
    : '';
  detail.innerHTML =
    '<button class="sl-chip sl-plaza-back" onclick="slPlazaBack()">' +
    '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2L4 7l5 5"/></svg>' +
    '<span>返回广场</span></button>' +
    '<div class="sl-plaza-detail-head">' +
    (info.cover ? '<img class="sl-plaza-detail-cover" src="' + slEsc(info.cover) + '" alt="" onerror="this.style.opacity=0.15">' : '<div class="sl-plaza-detail-cover sl-plaza-cover-empty"></div>') +
    '<div style="flex:1;min-width:0"><div class="fx-title" style="font-size:22px">' + slEsc(info.name || st.title || '在线歌单') + '</div>' +
    '<div class="fx-sub" style="margin-top:6px">' + slEsc(slSourceName(st.source)) + (info.author ? (' · ' + slEsc(info.author)) : '') + (st.total ? (' · ' + st.total + ' 首') : '') + (info.playCount ? (' · ' + slEsc(String(info.playCount)) + '次播放') : '') + '</div>' +
    (info.desc ? '<div class="sl-detail-desc" style="margin-top:10px;max-width:560px">' + slEsc(String(info.desc).slice(0, 200)) + '</div>' : '') +
    '<div class="sl-detail-actions" style="margin-top:16px">' +
    '<button class="modal-btn primary" onclick="slPlazaPlayAll()">播放全部</button>' +
    '<button class="modal-btn" onclick="slPlazaCollect()">收藏为本地歌单</button>' +
    '</div></div></div>' +
    '<div class="sl-plaza-tracks">' + rows + '</div>' + footer;
  detail.querySelectorAll('[data-sl-track]').forEach(function (row) {
    row.addEventListener('click', function () {
      var idx = Number(row.getAttribute('data-sl-track'));
      var song = st.tracks[idx];
      if (!song) return;
      playQueue.splice((currentIdx | 0) + 1, 0, typeof cloneSong === 'function' ? cloneSong(song) : song);
      currentIdx = (currentIdx | 0) + 1;
      playQueueAt(currentIdx);
      showToast('已开始播放: ' + (song.name || ''));
    });
  });
  slRefreshPlazaPlayingRows();
  setTimeout(slPlazaMaybeLoadMore, 80);
}

// 标记广场/弹窗歌曲列表中"正在播放"的行（青色高亮 + 均衡器动画）
function slRefreshPlazaPlayingRows() {
  var rows = document.querySelectorAll('[data-sl-track]');
  if (!rows.length) return;
  var cur = (typeof playQueue !== 'undefined' && playQueue.length && typeof currentIdx === 'number' && currentIdx >= 0) ? playQueue[currentIdx] : null;
  var curKey = (cur && typeof queueItemKey === 'function') ? queueItemKey(cur) : '';
  rows.forEach(function (row) {
    var idx = Number(row.getAttribute('data-sl-track'));
    var st = row.closest('#sl-plaza-detail') ? slPlazaDetail : slDetailState;
    var song = (st && st.tracks) ? st.tracks[idx] : null;
    // 当前歌曲不在本列表时, 清掉所有行标记, 特效只跟随正在播放的歌
    row.classList.toggle('playing', !!(song && curKey && queueItemKey(song) === curKey));
  });
}

function slPlazaDetailLoadMore() {
  var st = slPlazaDetail;
  if (!st || st.loading || !st.hasMore) return;
  st.loading = true;
  renderSlPlazaDetail();
  apiJson('/api/lx/songlist/detail?source=' + st.source + '&id=' + encodeURIComponent(st.id) + '&page=' + st.page, { timeoutMs: 25000 }).then(function (r) {
    st.loading = false;
    if (!r || !r.success) {
      showToast('歌单详情加载失败: ' + ((r && r.error) || '未知错误'));
      if (!st.tracks.length) st.hasMore = false;
      renderSlPlazaDetail();
      return;
    }
    if (!st.info && r.info) st.info = r.info;
    st.tracks = st.tracks.concat(r.tracks || []);
    st.total = Number(r.total) || st.tracks.length;
    // 本页无新增歌曲 → 视为没有更多, 防止自动加载死循环
    st.hasMore = !!r.hasMore && (r.tracks ? r.tracks.length : 0) > 0;
    st.page += 1;
    renderSlPlazaDetail();
  }).catch(function (e) {
    st.loading = false;
    showToast('歌单详情加载失败: ' + ((e && e.message) || '网络错误'));
    renderSlPlazaDetail();
  });
}

function slPlazaPlayAll() {
  var st = slPlazaDetail;
  if (!st) return;
  var name = (st.info && st.info.name) || st.title || '在线歌单';
  loadPlaylistIntoQueueById(slDetailIdOf(st.source, st.id), true, name);
}

function slPlazaCollect() {
  var st = slPlazaDetail;
  if (!st) return;
  var name = (st.info && st.info.name) || st.title || ('在线歌单 ' + slSourceName(st.source));
  showToast('正在收藏「' + name + '」...');
  var allSongs = [];
  var page = 1;
  var collectNext = function () {
    apiJson('/api/lx/songlist/detail?source=' + st.source + '&id=' + encodeURIComponent(st.id) + '&page=' + page, { timeoutMs: 25000 }).then(function (r) {
      if (!r || !r.success) {
        showToast('收藏失败: ' + ((r && r.error) || '获取详情失败'));
        return;
      }
      allSongs = allSongs.concat(r.tracks || []);
      if (r.hasMore && r.tracks && r.tracks.length && allSongs.length < 2000) {
        page += 1;
        collectNext();
        return;
      }
      var result = (typeof importLxDataLists === 'function') ? importLxDataLists([{ name: name, items: allSongs }]) : null;
      showToast('已收藏「' + name + '」: ' + (result ? result.addedSongs + ' 首' : allSongs.length + ' 首') + ' · 在"我的歌单"查看');
    }).catch(function (e) {
      showToast('收藏失败: ' + ((e && e.message) || '网络错误'));
    });
  };
  collectNext();
}

// ---------- 歌单详情弹窗 ----------
function ensureSongListDetailModal() {
  var modal = document.getElementById('songlist-detail-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'songlist-detail-modal';
  modal.className = 'modal-mask';
  modal.innerHTML = '<div class="modal sl-detail-modal"><div id="sl-detail-body"></div>' +
    '<div class="btn-row"><button class="modal-btn" onclick="closeGsapModal(document.getElementById(\'songlist-detail-modal\'))">关闭</button></div></div>';
  document.body.appendChild(modal);
  var body = document.getElementById('sl-detail-body');
  slBindCardClicks(body);
  return modal;
}

function openSongListDetailModal(source, id, title) {
  if (!source || !id) return;
  var modal = ensureSongListDetailModal();
  // loading 初始必须为 false: slDetailLoadMore 的守卫会拦截 loading 状态
  slDetailState = { source: source, id: id, page: 1, tracks: [], total: 0, info: null, loading: false, hasMore: true };
  if (typeof openGsapModal === 'function') openGsapModal(modal);
  renderSongListDetailModal();
  slDetailLoadMore();
}

function renderSongListDetailModal() {
  var st = slDetailState;
  if (!st) return;
  var body = document.getElementById('sl-detail-body');
  if (!body) return;
  var info = st.info || {};
  var head = '<div class="sl-detail-head">' +
    (info.cover ? '<img class="sl-detail-cover" src="' + slEsc(info.cover) + '" alt="" onerror="this.style.opacity=0.2">' : '<div class="sl-detail-cover"></div>') +
    '<div style="flex:1;min-width:0"><div class="collect-title">' + slEsc(info.name || st.title || '在线歌单') + '</div>' +
    '<div class="collect-sub">' + slEsc(slSourceName(st.source)) + (info.author ? (' · ' + slEsc(info.author)) : '') + (st.total ? (' · ' + st.total + ' 首') : '') + (info.playCount ? (' · ' + slEsc(String(info.playCount)) + '次播放') : '') + '</div>' +
    (info.desc ? '<div class="sl-detail-desc">' + slEsc(String(info.desc).slice(0, 120)) + '</div>' : '') +
    '</div></div>';
  var actions = '<div class="sl-detail-actions">' +
    '<button class="modal-btn primary" onclick="slPlayWholeSongList()">播放全部</button>' +
    '<button class="modal-btn" onclick="slCollectSongList()">收藏为本地歌单</button>' +
    '</div>';
  var rows = st.tracks.map(function (song, i) {
    var thumb = song.cover ? '<img src="' + slEsc(song.cover) + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">' : '<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06);flex:0 0 auto"></div>';
    return '<div class="sl-track-row" data-sl-track="' + i + '">' +
      '<span class="sl-track-idx">' + (i + 1) + '</span><span class="sl-track-eq" aria-hidden="true"><i></i><i></i><i></i></span>' + thumb +
      '<div style="flex:1;min-width:0"><div class="pl-name" style="font-size:12px">' + slEsc(song.name) + '</div>' +
      '<div class="pl-sub">' + slEsc(song.artist || '') + (song.album ? (' · ' + slEsc(song.album)) : '') + '</div></div>' +
      '<span class="tag-source ' + song.provider + '" style="flex:none">' + slSourceName(song.provider === 'lx' ? '' : song.provider) || slSourceName(song.lxSource || song.provider) + '</span>' +
      '</div>';
  }).join('');
  var footer = st.loading
    ? '<div class="playlist-catalog-status" style="margin-top:8px"><span class="queue-hydration-spinner spinning"></span><span>正在载入歌曲...</span></div>'
    : (st.hasMore ? '<div class="local-playlist-footer"><button class="fx-mini-btn ghost" onclick="slDetailLoadMore()">加载更多歌曲</button></div>' : '');
  body.innerHTML = head + actions + '<div id="sl-detail-list" style="margin-top:8px;max-height:46vh;overflow-y:auto">' + rows + '</div>' + footer;
  body.querySelectorAll('[data-sl-track]').forEach(function (row) {
    row.addEventListener('click', function () {
      var idx = Number(row.getAttribute('data-sl-track'));
      var song = st.tracks[idx];
      if (!song) return;
      playQueue.splice((currentIdx | 0) + 1, 0, typeof cloneSong === 'function' ? cloneSong(song) : song);
      currentIdx = (currentIdx | 0) + 1;
      playQueueAt(currentIdx);
    });
  });
  slRefreshPlazaPlayingRows();
}

function slDetailLoadMore() {
  var st = slDetailState;
  if (!st || st.loading || !st.hasMore) return;
  st.loading = true;
  renderSongListDetailModal();
  apiJson('/api/lx/songlist/detail?source=' + st.source + '&id=' + encodeURIComponent(st.id) + '&page=' + st.page, { timeoutMs: 25000 }).then(function (r) {
    st.loading = false;
    if (!r || !r.success) {
      showToast('歌单详情加载失败: ' + ((r && r.error) || '未知错误'));
      if (!st.tracks.length) st.hasMore = false;
      renderSongListDetailModal();
      return;
    }
    st.info = st.info || r.info;
    if (st.info && r.info && !st.info.name) st.info.name = r.info.name;
    st.tracks = st.tracks.concat(r.tracks || []);
    st.total = Number(r.total) || st.tracks.length;
    st.hasMore = !!r.hasMore;
    st.page += 1;
    renderSongListDetailModal();
  }).catch(function (e) {
    st.loading = false;
    showToast('歌单详情加载失败: ' + ((e && e.message) || '网络错误'));
    renderSongListDetailModal();
  });
}

// 播放整单: 走 lxsl 前缀 → 流式分页入队
function slPlayWholeSongList() {
  var st = slDetailState;
  if (!st) return;
  var name = (st.info && st.info.name) || st.title || '在线歌单';
  closeGsapModal(document.getElementById('songlist-detail-modal'));
  loadPlaylistIntoQueueById(slDetailIdOf(st.source, st.id), true, name);
}

// 收藏: 全量拉取 → 写入本地歌单
function slCollectSongList() {
  var st = slDetailState;
  if (!st) return;
  var name = (st.info && st.info.name) || st.title || ('在线歌单 ' + slSourceName(st.source));
  if (typeof getLocalPlaylists === 'function' && getLocalPlaylists().some(function (l) { return l.name === name; })) {
    showToast('本地已有同名歌单, 歌曲会合并进去');
  }
  showToast('正在收藏「' + name + '」...');
  var allSongs = [];
  var page = 1;
  var collectNext = function () {
    apiJson('/api/lx/songlist/detail?source=' + st.source + '&id=' + encodeURIComponent(st.id) + '&page=' + page, { timeoutMs: 25000 }).then(function (r) {
      if (!r || !r.success) {
        showToast('收藏失败: ' + ((r && r.error) || '获取详情失败'));
        return;
      }
      allSongs = allSongs.concat(r.tracks || []);
      if (r.hasMore && r.tracks && r.tracks.length && allSongs.length < 2000) {
        page += 1;
        collectNext();
        return;
      }
      var result = (typeof importLxDataLists === 'function')
        ? importLxDataLists([{ name: name, items: allSongs }])
        : null;
      showToast('已收藏「' + name + '」: ' + (result ? result.addedSongs + ' 首' : allSongs.length + ' 首'));
    }).catch(function (e) {
      showToast('收藏失败: ' + ((e && e.message) || '网络错误'));
    });
  };
  collectNext();
}

// ---------- 搜索页歌单结果 ----------
function handleSongListSearch(q) {
  var st = slSearchState;
  var seq = ++st.seq;
  st.query = q;
  st.page = 1;
  st.lists = [];
  st.loading = true;
  var $results = document.getElementById('search-results');
  if ($results) {
    $results.classList.add('show');
    $results.innerHTML = '<div class="search-empty"><span class="queue-hydration-spinner spinning"></span> 正在搜索歌单...</div>';
  }
  apiJson('/api/lx/songlist/search?source=all&keywords=' + encodeURIComponent(q) + '&page=1&limit=15', { timeoutMs: 20000 }).then(function (r) {
    if (seq !== st.seq) return;
    st.loading = false;
    st.lists = (r && r.lists) || [];
    st.total = (r && r.total) || st.lists.length;
    st.hasMore = !!(r && r.hasMore);
    renderSongListSearchResults();
  }).catch(function () {
    if (seq !== st.seq) return;
    st.loading = false;
    if ($results) $results.innerHTML = '<div class="search-empty">歌单搜索失败</div>';
  });
}

function slSearchLoadMore() {
  var st = slSearchState;
  if (st.loading || !st.hasMore) return;
  st.loading = true;
  var seq = st.seq;
  apiJson('/api/lx/songlist/search?source=all&keywords=' + encodeURIComponent(st.query) + '&page=' + (st.page + 1) + '&limit=15', { timeoutMs: 20000 }).then(function (r) {
    if (seq !== st.seq) return;
    st.loading = false;
    st.page += 1;
    st.lists = st.lists.concat((r && r.lists) || []);
    st.hasMore = !!(r && r.hasMore);
    renderSongListSearchResults();
  }).catch(function () { st.loading = false; });
}

function renderSongListSearchResults() {
  var st = slSearchState;
  var $results = document.getElementById('search-results');
  if (!$results) return;
  if (!st.lists.length) {
    $results.innerHTML = '<div class="search-empty">没有找到相关歌单</div>';
    return;
  }
  var cards = st.lists.map(slSquareCardHtml).join('');
  var more = st.hasMore
    ? '<div style="text-align:center;padding:10px 0"><button class="fx-mini-btn ghost" onclick="slSearchLoadMore()">加载更多歌单</button></div>'
    : '';
  $results.innerHTML = '<div class="sl-search-grid">' + cards + '</div>' + more;
  $results.classList.add('show');
  slBindCardClicks($results);
  if (window.gsap) animateListItems($results, '.sl-card', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}
