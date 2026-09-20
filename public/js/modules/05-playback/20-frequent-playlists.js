// ============================================================
// 常听排行榜 — Home 首页"常听歌单 + 常听歌曲"双榜
// 左: 歌单榜 (账号收藏 / 本地 / 音乐广场, 按打开次数)
// 右: 歌曲榜 (按实际播放次数, 数据来自 02-listen-stats.js)
// 竖排列表, 各取前 8, 可独立折叠
// ============================================================
var FREQ_PL_STORE_KEY = 'mineradio-frequent-playlists-v1';
var FREQ_PL_FOLD_PL_KEY = 'mineradio-frequent-fold-pl-v1';
var FREQ_PL_FOLD_SONG_KEY = 'mineradio-frequent-fold-song-v1';
var FREQ_PL_MAX_ITEMS = 120;

function readFrequentPlaylistStore() {
  try {
    var raw = JSON.parse(localStorage.getItem(FREQ_PL_STORE_KEY) || '{}');
    if (raw && typeof raw === 'object' && Array.isArray(raw.items)) return raw;
  } catch (_) { }
  return { items: [] };
}

function saveFrequentPlaylistStore(store) {
  try { localStorage.setItem(FREQ_PL_STORE_KEY, JSON.stringify(store)); } catch (_) { }
}

function frequentPlaylistKey(type, source, id) {
  return type + ':' + (source || '') + ':' + id;
}

function frequentPlaylistSort(items) {
  return items.sort(function (a, b) {
    return b.count - a.count || (b.lastAt || 0) - (a.lastAt || 0);
  });
}

// 打开歌单时记录: { type:'plaza'|'account'|'local', source, id, name, cover }
function frequentPlaylistTrack(rec) {
  if (!rec || !rec.id) return;
  var store = readFrequentPlaylistStore();
  var key = frequentPlaylistKey(rec.type, rec.source, rec.id);
  var item = store.items.find(function (it) { return it.key === key; });
  if (!item) {
    item = { key: key, count: 0 };
    store.items.push(item);
  }
  item.count += 1;
  item.lastAt = Date.now();
  if (rec.name) item.name = rec.name;
  if (rec.source != null) item.source = rec.source;
  if (rec.cover) item.cover = rec.cover;
  frequentPlaylistSort(store.items);
  if (store.items.length > FREQ_PL_MAX_ITEMS) store.items = store.items.slice(0, FREQ_PL_MAX_ITEMS);
  saveFrequentPlaylistStore(store);
  if (typeof renderHomeFrequentPlaylists === 'function') renderHomeFrequentPlaylists();
}

// 广场歌单封面在详情加载后才拿到, 到手后回填
function frequentPlaylistCoverUpdate(key, cover) {
  if (!key || !cover) return;
  var store = readFrequentPlaylistStore();
  var item = store.items.find(function (it) { return it.key === key; });
  if (!item || item.cover === cover) return;
  item.cover = cover;
  saveFrequentPlaylistStore(store);
  if (typeof renderHomeFrequentPlaylists === 'function') renderHomeFrequentPlaylists();
}

function frequentPlaylistsTop() {
  return frequentPlaylistSort(readFrequentPlaylistStore().items.slice());
}

// 歌曲榜: 复用听歌统计 (plays 次数), key 关联最近记录用于点播
function frequentSongsTop() {
  if (typeof listenStatsState === 'undefined' || !listenStatsState.songs) return [];
  var list = Object.keys(listenStatsState.songs).map(function (key) { return listenStatsState.songs[key]; });
  list.sort(function (a, b) {
    return (b.plays - a.plays) || (b.listenMs - a.listenMs) || (b.lastPlayedAt - a.lastPlayedAt);
  });
  return list;
}

function homeFrequentEsc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function homeRankRowHtml(index, rec) {
  var rankCls = index === 0 ? ' top1' : index === 1 ? ' top2' : index === 2 ? ' top3' : '';
  var cover = rec.cover
    ? '<img src="' + homeFrequentEsc(rec.cover) + '" alt="" loading="lazy" onerror="this.classList.add(\'no-img\')">'
    : '';
  return '<button class="home-rank-row" type="button" ' + (rec.action || '') + (rec.title ? ' title="' + homeFrequentEsc(rec.title) + '"' : '') + '>'
    + '<span class="home-rank-num' + rankCls + '">' + (index + 1) + '</span>'
    + '<span class="home-rank-thumb">' + cover + (cover ? '' : '<i>' + homeFrequentEsc((rec.name || '?').slice(0, 1)) + '</i>') + '</span>'
    + '<span class="home-rank-meta">'
    + '<span class="home-rank-name">' + homeFrequentEsc(rec.name || '未命名') + '</span>'
    + '<span class="home-rank-sub">' + homeFrequentEsc(rec.sub || '') + '</span>'
    + '</span>'
    + '<span class="home-rank-count">' + rec.count + '<i>次</i></span>'
    + '</button>';
}

function homeFrequentSourceLabel(type, source) {
  if (type === 'plaza') return '音乐广场 · ' + (typeof slSourceName === 'function' ? slSourceName(source) : (source || '').toUpperCase());
  if (type === 'local') return '本地歌单';
  if (source === 'lxsl') return '收藏歌单 · 在线';
  var names = { netease: '网易云', qq: 'QQ', kugou: '酷狗', qishui: '汽水', spotify: 'Spotify' };
  return '收藏歌单 · ' + (names[source] || (source || '').toUpperCase());
}

// 本地歌单记录没有 cover (打开时 userPlaylists 里查不到 local 歌单), 渲染时用第一首带封面的歌兜底
function frequentPlaylistLocalCover(id) {
  if (typeof getLocalPlaylists !== 'function') return '';
  var list = getLocalPlaylists().find(function (l) { return String(l.id) === String(id); });
  return (list && list.cover) || '';
}

function renderHomeFrequentPlaylists() {
  var section = document.getElementById('home-frequent-section');
  if (!section) return;

  // 左榜: 歌单
  var plBody = document.getElementById('home-frequent-pl-body');
  var plItems = frequentPlaylistsTop();
  if (plBody) {
    if (plItems.length) {
      plBody.innerHTML = plItems.map(function (it, i) {
        var parts = it.key.split(':');
        var cover = it.cover || '';
        if (!cover && parts[0] === 'local') cover = frequentPlaylistLocalCover(parts.slice(2).join(':'));
        return homeRankRowHtml(i, {
          name: it.name || '未命名歌单',
          sub: homeFrequentSourceLabel(parts[0], parts[1]),
          cover: cover,
          count: it.count,
          action: 'onclick="openFrequentPlaylist(\'' + homeFrequentEsc(it.key) + '\')"',
          title: it.name || '',
        });
      }).join('');
    } else {
      plBody.innerHTML = '<div class="home-rank-empty">打开歌单后这里会生成排行</div>';
    }
  }

  // 右榜: 歌曲 (数据来自听歌统计)
  var songBody = document.getElementById('home-frequent-song-body');
  var songItems = frequentSongsTop();
  if (songBody) {
    if (songItems.length) {
      songBody.innerHTML = songItems.map(function (s, i) {
        return homeRankRowHtml(i, {
          name: s.name || '未知歌曲',
          sub: s.artist || s.source || '',
          cover: s.cover || '',
          count: s.plays || 0,
          action: 'onclick="openFrequentSong(\'' + homeFrequentEsc(s.key) + '\')"',
          title: s.name || '',
        });
      }).join('');
    } else {
      songBody.innerHTML = '<div class="home-rank-empty">播放歌曲后这里会生成排行</div>';
    }
  }

  var hasAny = plItems.length > 0 || songItems.length > 0;
  section.hidden = !hasAny;
}

// ---------- 折叠 (两榜独立) ----------
function homeFrequentFolded(which) {
  try {
    return localStorage.getItem(which === 'song' ? FREQ_PL_FOLD_SONG_KEY : FREQ_PL_FOLD_PL_KEY) === '1';
  } catch (_) { return false; }
}

function toggleHomeFrequentFold(which) {
  var key = which === 'song' ? FREQ_PL_FOLD_SONG_KEY : FREQ_PL_FOLD_PL_KEY;
  var next = !homeFrequentFolded(which);
  try { localStorage.setItem(key, next ? '1' : '0'); } catch (_) { }
  var panel = document.getElementById(which === 'song' ? 'home-frequent-song-panel' : 'home-frequent-pl-panel');
  if (panel) {
    panel.classList.toggle('folded', next);
    var head = panel.querySelector('.home-frequent-head');
    if (head) head.setAttribute('aria-expanded', next ? 'false' : 'true');
  }
}

// ---------- 打开 ----------
function openFrequentPlaylist(key) {
  var item = readFrequentPlaylistStore().items.find(function (it) { return it.key === key; });
  if (!item) return;
  var parts = key.split(':');
  var type = parts[0];
  var source = parts[1];
  var id = parts.slice(2).join(':');
  if (type === 'plaza') {
    if (typeof openSongListPlaza === 'function') openSongListPlaza();
    if (typeof slPlazaOpenDetail === 'function') slPlazaOpenDetail(source, id, item.name || '');
  } else if (type === 'local') {
    if (typeof openPlaylistPanelDetail === 'function') openPlaylistPanelDetail('local', id, item.name || '本地歌单');
  } else if (typeof openPlaylistPanelDetail === 'function') {
    openPlaylistPanelDetail(source, id, item.name || '');
  }
}

// 歌曲榜点击: 从最近记录里找回完整歌曲信息并播放
function openFrequentSong(key) {
  var hist = (typeof listenStatsState !== 'undefined' && listenStatsState.history) || [];
  var record = hist.find(function (h) { return h && h.key === key; });
  if (record && typeof playHomeRecent === 'function') {
    playHomeRecent(record);
    return;
  }
  if (typeof showToast === 'function') showToast('这首歌不在最近记录里了, 暂不能直接播放');
}

document.addEventListener('DOMContentLoaded', function () {
  ['pl', 'song'].forEach(function (which) {
    if (!homeFrequentFolded(which)) return;
    var panel = document.getElementById(which === 'song' ? 'home-frequent-song-panel' : 'home-frequent-pl-panel');
    if (panel) panel.classList.add('folded');
  });
});
