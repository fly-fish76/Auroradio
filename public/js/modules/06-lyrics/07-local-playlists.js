// ============================================================
// 本地歌单 (落雪列表管理迁移) — localStorage 持久化 + CRUD
// 数据: mineradio-local-playlists-v1 = {version:1, lists:[{id,name,createdAt,updatedAt,items:[song]}]}
// 接入点: 02-playlist-detail.js (面板/详情), 03-podcast-playlist-loaders.js (入队),
//         04-shelf/01-manager-core.js (3D 歌单架), 06-track-detail-lyrics-actions.js (收藏弹窗)
// ============================================================
var LOCAL_PLAYLISTS_STORE_KEY = 'mineradio-local-playlists-v1';

function readLocalPlaylistStore() {
  try {
    var raw = localStorage.getItem(LOCAL_PLAYLISTS_STORE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.lists)) return parsed;
  } catch (e) { /* 损坏数据当作空 */ }
  return { version: 1, lists: [] };
}

function saveLocalPlaylistStore(store) {
  try {
    localStorage.setItem(LOCAL_PLAYLISTS_STORE_KEY, JSON.stringify(store));
  } catch (e) {
    showToast('本地歌单保存失败（存储空间不足？）');
  }
}

function getLocalPlaylistSongs(id) {
  var store = readLocalPlaylistStore();
  var list = store.lists.find(function (l) { return String(l.id) === String(id); });
  return list && Array.isArray(list.items) ? list.items : [];
}

// 面板/歌单架用的歌单卡片数据 (对齐远程歌单 pl 形状)
function getLocalPlaylists() {
  var store = readLocalPlaylistStore();
  return store.lists.map(function (l) {
    var items = Array.isArray(l.items) ? l.items : [];
    var cover = '';
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].cover) { cover = items[i].cover; break; }
    }
    return {
      provider: 'local',
      source: 'local',
      id: l.id,
      name: l.name || '未命名歌单',
      trackCount: items.length,
      creator: '本地',
      cover: cover,
      playCount: 0,
      virtual: false,
      subscribed: false,
      createdAt: l.createdAt || 0,
      updatedAt: l.updatedAt || 0,
    };
  });
}

function localPlaylistChanged(opts) {
  opts = opts || {};
  playlistCatalogRevision += 1;
  if (typeof renderUserPlaylistsList === 'function') renderUserPlaylistsList({ animate: false, preserveScroll: true });
  if (opts.rebuildShelf !== false && typeof safeShelfRebuild === 'function') safeShelfRebuild('local-playlist-change', true);
}

function createLocalPlaylist(name, song) {
  name = String(name || '').trim();
  if (!name) { showToast('先输入歌单名称'); return null; }
  var store = readLocalPlaylistStore();
  var now = Date.now();
  var list = {
    id: 'local_' + now + '_' + Math.random().toString(36).slice(2, 7),
    name: name,
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  if (song) list.items.push(JSON.parse(JSON.stringify(song)));
  store.lists.push(list);
  saveLocalPlaylistStore(store);
  localPlaylistChanged();
  return list;
}

function addSongToLocalPlaylist(id, song) {
  if (!song || !song.name) return false;
  var store = readLocalPlaylistStore();
  var list = store.lists.find(function (l) { return String(l.id) === String(id); });
  if (!list) return false;
  if (!Array.isArray(list.items)) list.items = [];
  var key = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  for (var i = 0; i < list.items.length; i++) {
    if (key && typeof queueItemKey === 'function' && queueItemKey(list.items[i]) === key) {
      showToast('这首歌已在歌单里');
      return false;
    }
  }
  list.items.push(JSON.parse(JSON.stringify(song)));
  list.updatedAt = Date.now();
  saveLocalPlaylistStore(store);
  localPlaylistChanged();
  return true;
}

function removeSongFromLocalPlaylist(id, index) {
  var store = readLocalPlaylistStore();
  var list = store.lists.find(function (l) { return String(l.id) === String(id); });
  if (!list || !Array.isArray(list.items)) return false;
  if (index < 0 || index >= list.items.length) return false;
  list.items.splice(index, 1);
  list.updatedAt = Date.now();
  saveLocalPlaylistStore(store);
  localPlaylistChanged({ rebuildShelf: false });
  return true;
}

function renameLocalPlaylist(id, name) {
  name = String(name || '').trim();
  if (!name) { showToast('先输入歌单名称'); return false; }
  var store = readLocalPlaylistStore();
  var list = store.lists.find(function (l) { return String(l.id) === String(id); });
  if (!list) return false;
  list.name = name;
  list.updatedAt = Date.now();
  saveLocalPlaylistStore(store);
  localPlaylistChanged();
  return true;
}

function deleteLocalPlaylist(id) {
  var store = readLocalPlaylistStore();
  var idx = store.lists.findIndex(function (l) { return String(l.id) === String(id); });
  if (idx < 0) return false;
  store.lists.splice(idx, 1);
  saveLocalPlaylistStore(store);
  // 详情收起
  if (typeof playlistPanelDetailState !== 'undefined' && playlistPanelDetailState.key === 'local:' + id) {
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
  }
  localPlaylistChanged();
  return true;
}

// ---------- 导出 / 导入 (JSON 文件) ----------
function exportLocalPlaylists() {
  if (!window.desktopWindow || typeof window.desktopWindow.exportJsonFile !== 'function') {
    showToast('仅桌面版支持导出');
    return;
  }
  var store = readLocalPlaylistStore();
  if (!store.lists.length) { showToast('没有可导出的本地歌单'); return; }
  window.desktopWindow.exportJsonFile({
    defaultName: 'mineradio-local-playlists.json',
    data: store,
  }).then(function (result) {
    if (result && result.ok) showToast('已导出到 ' + result.filePath);
  }).catch(function () { showToast('导出失败'); });
}

function importLocalPlaylists() {
  if (!window.desktopWindow || typeof window.desktopWindow.importJsonFile !== 'function') {
    showToast('仅桌面版支持导入');
    return;
  }
  window.desktopWindow.importJsonFile().then(function (result) {
    if (!result || !result.ok || result.canceled || !result.text) return null;
    var parsed;
    try { parsed = JSON.parse(result.text); } catch (e) { showToast('文件不是有效的 JSON'); return null; }
    var incoming = parsed && Array.isArray(parsed.lists) ? parsed.lists : [];
    if (!incoming.length) { showToast('文件里没有歌单数据'); return null; }
    var store = readLocalPlaylistStore();
    var added = 0;
    incoming.forEach(function (l) {
      if (!l || !Array.isArray(l.items)) return;
      store.lists.push({
        id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: String(l.name || '导入歌单').slice(0, 60),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: l.items.filter(function (s) { return s && s.name; }),
      });
      added += 1;
    });
    saveLocalPlaylistStore(store);
    localPlaylistChanged();
    showToast('已导入 ' + added + ' 个本地歌单');
    return added;
  }).catch(function () { showToast('导入失败'); });
}

// ---------- 新建本地歌单弹窗 ----------
function openLocalPlaylistCreateModal(seedSong) {
  var modal = document.getElementById('local-list-modal');
  var input = document.getElementById('local-list-name');
  if (!modal || !input) return;
  input.value = '';
  modal.__seedSong = seedSong || null;
  if (typeof openGsapModal === 'function') openGsapModal(modal);
  setTimeout(function () { try { input.focus(); } catch (e) { } }, 120);
}

function submitLocalPlaylistCreate() {
  var modal = document.getElementById('local-list-modal');
  var input = document.getElementById('local-list-name');
  if (!modal || !input) return;
  var seed = modal.__seedSong || null;
  modal.__seedSong = null;
  var list = createLocalPlaylist(input.value, seed);
  if (!list) return;
  if (typeof closeGsapModal === 'function') closeGsapModal(modal);
  showToast('已创建「' + list.name + '」');
}

// ---------- 收藏弹窗: 本地歌单区块 ----------
function renderLocalCollectSectionHtml() {
  var lists = getLocalPlaylists();
  var html = '<div class="collect-section-label">本地歌单</div>';
  if (!lists.length) {
    html += '<div class="collect-empty">还没有本地歌单 · 可在下方直接创建</div>';
    return html;
  }
  html += lists.map(function (pl) {
    var thumb = pl.cover ? (typeof coverUrlWithSize === 'function' ? coverUrlWithSize(pl.cover, 80) : pl.cover) : '';
    return '<div class="collect-item local" data-local-pid="' + escHtml(String(pl.id)) + '" onclick="addCollectTargetToLocalPlaylist(this.getAttribute(\'data-local-pid\'))">' +
      (thumb ? '<img src="' + escHtml(thumb) + '" alt="">' : '<div class="cover-placeholder"></div>') +
      '<div style="min-width:0"><div class="collect-title">' + escHtml(pl.name || '') + '</div><div class="collect-sub">' + (pl.trackCount || 0) + ' 首</div></div>' +
      '</div>';
  }).join('');
  return html;
}

function addCollectTargetToLocalPlaylist(pid) {
  if (!pid || typeof collectTargetSong === 'undefined' || !collectTargetSong) return;
  var ok = addSongToLocalPlaylist(pid, collectTargetSong);
  if (ok) showToast('已加入本地歌单');
}

function createLocalPlaylistFromCollect() {
  var input = document.getElementById('collect-new-name');
  var name = input ? input.value.trim() : '';
  if (!name) { showToast('先输入歌单名称'); return; }
  var song = (typeof collectTargetSong !== 'undefined' && collectTargetSong) ? collectTargetSong : null;
  var list = createLocalPlaylist(name, song);
  if (!list) return;
  if (input) input.value = '';
  if (typeof renderCollectModal === 'function') renderCollectModal();
  showToast('已创建「' + list.name + '」并加入当前歌曲');
}

// ---------- 歌单详情操作 (面板内联详情) ----------
function localDetailPlaylistId() {
  var st = (typeof playlistPanelDetailState !== 'undefined') ? playlistPanelDetailState : null;
  if (!st || !st.key) return '';
  var parts = String(st.key).split(':');
  if (typeof normalizePlaylistProvider !== 'function' || normalizePlaylistProvider(parts[0]) !== 'local') return '';
  return parts.slice(1).join(':');
}

// 卡片行内 "+" 菜单没有展开详情可依赖, 优先从所在卡取歌单 id
function localDetailPlaylistIdFromCard(card) {
  if (card) {
    var provider = typeof normalizePlaylistProvider === 'function'
      ? normalizePlaylistProvider(card.getAttribute('data-playlist-provider') || '')
      : (card.getAttribute('data-playlist-provider') || '');
    if (provider === 'local') return card.getAttribute('data-playlist-id') || '';
  }
  return localDetailPlaylistId();
}

function removeLocalSongFromDetail(index) {
  var pid = localDetailPlaylistId();
  if (!pid) return;
  var st = playlistPanelDetailState;
  var song = st.tracks && st.tracks[index];
  if (!song) return;
  if (removeSongFromLocalPlaylist(pid, index)) {
    st.tracks = getLocalPlaylistSongs(pid).map(typeof cloneSong === 'function' ? cloneSong : function (s) { return s; });
    st.total = st.tracks.length;
    st.hasMore = false;
    if (st.playlist) st.playlist = Object.assign({}, st.playlist, { trackCount: st.tracks.length });
    if (typeof renderPlaylistPanelDetailState === 'function') renderPlaylistPanelDetailState();
    showToast('已移出「' + (song.name || '这首歌') + '」');
  }
}

function renameLocalPlaylistFromDetail(card) {
  var pid = localDetailPlaylistIdFromCard(card);
  if (!pid) return;
  var st = playlistPanelDetailState;
  var name = (card && card.getAttribute('data-playlist-title')) || (st.playlist && st.playlist.name) || '';
  openLocalPlaylistRenameModal(pid, name);
}

function deleteLocalPlaylistFromDetail(card) {
  var pid = localDetailPlaylistIdFromCard(card);
  if (!pid) return;
  if (deleteLocalPlaylist(pid)) showToast('已删除本地歌单');
}

function openLocalPlaylistRenameModal(pid, oldName) {
  var modal = document.getElementById('local-rename-modal');
  var input = document.getElementById('local-rename-name');
  if (!modal || !input) return;
  input.value = oldName || '';
  modal.__localPlaylistId = pid;
  if (typeof openGsapModal === 'function') openGsapModal(modal);
  setTimeout(function () { try { input.focus(); } catch (e) { } }, 120);
}

function submitLocalPlaylistRename() {
  var modal = document.getElementById('local-rename-modal');
  var input = document.getElementById('local-rename-name');
  if (!modal || !input) return;
  var pid = modal.__localPlaylistId || localDetailPlaylistId();
  modal.__localPlaylistId = null;
  if (!renameLocalPlaylist(pid, input.value)) return;
  if (typeof closeGsapModal === 'function') closeGsapModal(modal);
  showToast('已重命名');
}

// ---------- 从落雪 LxDatas 导入的数据落库 ----------
function localPlaylistSongKey(song) {
  if (song && song.provider === 'lx') return 'lx:' + (song.lxSource || '') + ':' + (song.songmid || '');
  if (typeof queueItemKey === 'function') {
    try { return queueItemKey(song); } catch (_) { }
  }
  return ((song && song.provider) || '') + ':' + ((song && (song.id || song.songmid)) || '');
}

// lists: server /api/lxsource/import-lx-data 返回的 [{name, items:[song]}]
function importLxDataLists(lists) {
  var store = readLocalPlaylistStore();
  var createdLists = 0;
  var addedSongs = 0;
  (lists || []).forEach(function (lxList) {
    if (!lxList || !lxList.name || !Array.isArray(lxList.items)) return;
    var list = store.lists.find(function (l) { return l.name === lxList.name; });
    if (!list) {
      list = {
        id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: lxList.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        items: [],
      };
      store.lists.push(list);
      createdLists += 1;
    }
    if (!Array.isArray(list.items)) list.items = [];
    lxList.items.forEach(function (song) {
      if (!song || !song.name) return;
      var key = localPlaylistSongKey(song);
      var exists = list.items.some(function (s) { return localPlaylistSongKey(s) === key; });
      if (!exists) {
        list.items.push(song);
        addedSongs += 1;
      }
    });
    list.updatedAt = Date.now();
  });
  saveLocalPlaylistStore(store);
  if (createdLists || addedSongs) localPlaylistChanged();
  return { createdLists: createdLists, addedSongs: addedSongs };
}

// ---------- 链接导入歌单 (汽水分享链接) ----------
function openLocalPlaylistLinkImportModal() {
  var modal = document.getElementById('local-link-import-modal');
  var input = document.getElementById('local-link-import-text');
  var hint = document.getElementById('local-link-import-hint');
  if (!modal || !input) return;
  input.value = '';
  if (hint) hint.textContent = '支持汽水 / 网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕 歌单分享链接';
  if (typeof openGsapModal === 'function') openGsapModal(modal);
  setTimeout(function () { try { input.focus(); } catch (e) { } }, 120);
}

var LINK_IMPORT_SOURCE_NAMES = {
  qishui: '汽水', wy: '网易云', tx: 'QQ音乐', kg: '酷狗', kw: '酷我', mg: '咪咕',
};

function submitLocalPlaylistLinkImport() {
  var modal = document.getElementById('local-link-import-modal');
  var input = document.getElementById('local-link-import-text');
  var hint = document.getElementById('local-link-import-hint');
  if (!modal || !input) return;
  var text = String(input.value || '').trim();
  if (!text) { showToast('先粘贴分享链接或文案'); return; }
  if (hint) hint.textContent = '正在解析分享链接...';
  apiJson('/api/playlist/from-share?text=' + encodeURIComponent(text), { timeoutMs: 45000 }).then(function (r) {
    if (!r || !r.success || !r.tracks || !r.tracks.length) {
      if (hint) hint.textContent = '';
      showToast('导入失败: ' + ((r && (r.message || r.error)) || '未能解析出歌单'));
      return;
    }
    var meta = r.playlist || {};
    var sourceName = LINK_IMPORT_SOURCE_NAMES[r.source] || '链接';
    var res = importLxDataLists([{ name: meta.title || (sourceName + '导入歌单'), items: r.tracks }]);
    if (typeof closeGsapModal === 'function') closeGsapModal(modal);
    var msg = '已导入「' + (meta.title || (sourceName + '歌单')) + '」 ' + r.tracks.length + ' 首';
    if (r.partial) msg += '（当前仅获取 ' + r.tracks.length + ' / ' + (meta.total || '?') + ' 首，可登录该平台后重新导入补全）';
    showToast(msg);
    if (hint) hint.textContent = '';
  }).catch(function (e) {
    if (hint) hint.textContent = '';
    showToast('导入失败: ' + ((e && e.message) || '网络错误'));
  });
}

// ---------- 我的歌单列表 footer ----------
function localPlaylistFooterHtml() {
  return '<div class="local-playlist-footer">'
    + '<button class="fx-mini-btn" type="button" onclick="openLocalPlaylistCreateModal()">＋ 新建本地歌单</button>'
    + '<button class="fx-mini-btn ghost" type="button" onclick="exportLocalPlaylists()">导出</button>'
    + '<button class="fx-mini-btn ghost" type="button" onclick="importLocalPlaylists()">导入</button>'
    + '<button class="fx-mini-btn ghost" type="button" onclick="openLocalPlaylistLinkImportModal()">🔗 链接</button>'
    + '</div>';
}
