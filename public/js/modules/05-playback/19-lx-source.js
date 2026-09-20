// ============================================================
// lx 自定义音源 (落雪音乐音源脚本) — 渲染侧支持模块
// 状态缓存 / 平台映射 / 质量映射 / 播放 URL 解析
// 依赖 (运行时): apiJson (00-api-quality-output), songProviderKey (07-search)
// ============================================================
var LX_SOURCE_PREFER_STORE_KEY = 'mineradio-lx-source-prefer-v1';
var lxSourceState = {
  loaded: false,
  available: false,
  active: false,
  status: false,
  sources: {},
  name: '',
};

// Auroradio 平台 → 落雪音源平台
function lxProviderToSource(provider) {
  if (provider === 'netease') return 'wy';
  if (provider === 'qq') return 'tx';
  if (provider === 'kugou') return 'kg';
  return null;
}

function lxSourceSupports(provider, song) {
  var src = (provider === 'lx' && song) ? String(song.lxSource || '') : lxProviderToSource(provider);
  if (!src) return false;
  var info = lxSourceState.sources && lxSourceState.sources[src];
  return !!(info && info.actions && info.actions.indexOf('musicUrl') >= 0);
}

// Auroradio 质量档位 → 落雪音质链 (失败逐级下探)
function lxQualityChainFor(qualityKey) {
  if (qualityKey === 'jymaster' || qualityKey === 'hires') return ['flac24bit', 'flac', '320k', '128k'];
  if (qualityKey === 'lossless') return ['flac', '320k', '128k'];
  if (qualityKey === 'exhigh') return ['320k', '128k'];
  return ['128k'];
}

// 落雪音质 → Auroradio 质量档位 (用于 level 展示)
function lxQualityToProviderLevel(lxQuality) {
  if (lxQuality === 'flac24bit') return 'hires';
  if (lxQuality === 'flac') return 'lossless';
  if (lxQuality === '320k') return 'exhigh';
  return 'standard';
}

function lxSourcePreferEnabled() {
  // 默认开启: 落雪音源激活时所有歌曲优先走落雪解析 (显式设 '0' 关闭)
  try { return localStorage.getItem(LX_SOURCE_PREFER_STORE_KEY) !== '0'; } catch (_) { return true; }
}

// 落雪音源激活时所有平台都优先走落雪: wy/kg/tx 直接解析, 其它平台 (汽水/Spotify) 走匹配流
function lxSourcePrefersDirect(provider) {
  if (!lxSourcePreferEnabled()) return false;
  if (!lxSourceState.status || !lxSourceState.active) return false;
  if (provider === 'lx') return true;
  var src = lxProviderToSource(provider);
  if (src) return lxSourceSupports(provider);
  return true; // qishui / spotify 等 → 匹配流
}

// 落雪音源是否已激活 (同步判断; 播放失败提示等场景用)
function lxSourceActiveForPlayback() {
  return !!(lxSourceState.active && lxSourceState.status);
}

async function refreshLxSourceStatus() {
  try {
    var data = await apiJson('/api/lxsource/status');
    lxSourceState.loaded = true;
    lxSourceState.available = !!data.available;
    lxSourceState.active = !!data.active;
    lxSourceState.status = !!data.status;
    lxSourceState.sources = data.sources || {};
    lxSourceState.name = data.name || '';
  } catch (_) {
    lxSourceState.loaded = true;
    lxSourceState.available = false;
    lxSourceState.active = false;
    lxSourceState.status = false;
    lxSourceState.sources = {};
  }
  return lxSourceState;
}

function lxSourceSongQuery(song, src) {
  var singer = song.singer || song.artist || (song.artists || []).map(function (a) { return a && a.name; }).filter(Boolean).join('、');
  var q = 'source=' + encodeURIComponent(src)
    + '&name=' + encodeURIComponent(song.name || '')
    + '&singer=' + encodeURIComponent(singer || '')
    + '&album=' + encodeURIComponent(song.album || '')
    + '&img=' + encodeURIComponent(song.cover || '');
  if (song.duration) {
    var interval = String(Math.round(Number(song.duration) / 1000));
    if (interval && interval !== '0') q += '&interval=' + encodeURIComponent(interval);
  }
  if (src === 'wy') {
    q += '&songmid=' + encodeURIComponent(song.id || song.songmid || '');
  } else if (src === 'tx') {
    q += '&songmid=' + encodeURIComponent(song.songmid || song.id || '')
      + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.mid || '');
  } else if (src === 'kg') {
    var hash = song.hash || song.fileHash || song.audioHash || song.songmid || song.id || '';
    q += '&songmid=' + encodeURIComponent(hash)
      + '&hash=' + encodeURIComponent(hash);
  } else {
    // kw / mg 等仅脚本可解析的平台: 只需要 songmid
    q += '&songmid=' + encodeURIComponent(song.songmid || song.id || '');
  }
  return q;
}

// 按歌名+歌手在落雪五平台匹配一首可解析的歌 (汽水/Spotify 等无落雪平台 ID 的歌用)
async function lxMatchSongForResolution(song) {
  var keywords = [song.name || song.title, song.artist || song.singer].filter(Boolean).join(' ');
  if (!keywords) return null;
  try {
    var r = await apiJson('/api/lx/search?source=all&keywords=' + encodeURIComponent(keywords) + '&limit=20', { timeoutMs: 15000 });
    var songs = (r && r.songs) || [];
    if (!songs.length) return null;
    var name = String(song.name || song.title || '').toLowerCase();
    var singer = String(song.artist || song.singer || '').toLowerCase();
    var best = null;
    var bestScore = -1;
    songs.forEach(function (s) {
      var sName = String(s.name || '').toLowerCase();
      var sArtist = String(s.artist || '').toLowerCase();
      var score = 0;
      if (sName === name) score += 10;
      else if (sName.indexOf(name) >= 0 || name.indexOf(sName) >= 0) score += 6;
      if (singer && sArtist) {
        if (sArtist === singer) score += 6;
        else if (sArtist.indexOf(singer) >= 0 || singer.indexOf(sArtist) >= 0) score += 4;
        else {
          var tokens = singer.split(/[、,，\/&]/);
          for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i].trim();
            if (t && sArtist.indexOf(t) >= 0) { score += 2; break; }
          }
        }
      }
      if (s.provider === 'netease' || s.provider === 'qq' || s.provider === 'kugou') score += 1;
      if (score > bestScore) { bestScore = score; best = s; }
    });
    if (!best || bestScore < 9) return null; // 歌名至少部分匹配
    return best;
  } catch (_) {
    return null;
  }
}

// 尝试用 lx 自定义音源解析播放 URL; 失败返回 null
async function tryLxSourceResolution(song, requestedQuality, playbackProvider, allowMatch) {
  if (allowMatch === undefined) allowMatch = true;
  if (!song) return null;
  if (!lxSourceState.status || !lxSourceState.active) {
    if (!lxSourceState.loaded) await refreshLxSourceStatus();
    if (!lxSourceState.status || !lxSourceState.active) return null;
  }
  var provider = playbackProvider || (typeof songProviderKey === 'function' ? normalizePlaybackProvider(songProviderKey(song)) : '');
  var src = (provider === 'lx') ? String(song.lxSource || '') : lxProviderToSource(provider);
  if (!src || !lxSourceSupports(provider, song)) {
    // 汽水/Spotify 等无落雪平台 ID, 或脚本不支持该平台 → 按歌名+歌手匹配后重试
    if (!allowMatch) return null;
    var matched = await lxMatchSongForResolution(song);
    if (!matched) return null;
    return tryLxSourceResolution(matched, requestedQuality, matched.provider === 'lx' ? 'lx' : matched.provider, false);
  }
  var srcInfo = lxSourceState.sources[src] || {};
  var qualitys = srcInfo.qualitys || [];
  // 整条质量链一次并行竞速 (服务端全脚本全档位并行, 取可用最高音质)
  var chain = lxQualityChainFor(requestedQuality || 'standard').filter(function (q) {
    return qualitys.indexOf(q) >= 0;
  });
  if (!chain.length) return null;
  try {
    var data = await apiJson('/api/lxsource/song/url?' + lxSourceSongQuery(song, src) + '&quality=' + encodeURIComponent(chain.join(',')), { timeoutMs: 30000 });
    if (data && data.url) {
      return {
        provider: 'lx',
        source: 'lx',
        url: data.url,
        level: lxQualityToProviderLevel(data.type || chain[chain.length - 1]),
        type: data.type || chain[chain.length - 1],
        via: data.via || '',
        trial: false,
        lxResolved: true,
      };
    }
  } catch (_) { /* 全部脚本全档位失败 */ }
  return null;
}
