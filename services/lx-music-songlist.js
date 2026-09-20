'use strict';

// 落雪在线歌单 (歌单广场 / 歌单搜索 / 歌单详情)
// 移植自 lyswhut/lx-music-desktop src/renderer/utils/musicSdk/{kw,kg,tx,wy,mg}/songList.js（Apache-2.0）
// Copyright (C) lx-music-desktop authors — https://github.com/lyswhut/lx-music-desktop
// 歌曲统一映射: wy→netease, kg→kugou, tx→qq (原生播放); kw/mg→provider:'lx' (脚本解析)

const crypto = require('crypto');
const { util } = require('./lx-music-search');
const { httpRequest, httpJson, decodeName, formatPlayTime, sizeFormate, md5 } = util;

const MG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.music.migu.cn/',
};
const KW_UA = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36';

const formatPlayCount = (num) => {
  num = Number(num) || 0;
  if (num > 100000000) return parseInt(num / 10000000) / 10 + '亿';
  if (num > 10000) return parseInt(num / 1000) / 10 + '万';
  return String(num);
};

// ---------- 全量详情缓存 (tx/wy/kg 一次拉全, 分页切片) ----------
const detailCache = new Map(); // key -> {info, tracks, total, ts}
const DETAIL_CACHE_TTL = 10 * 60 * 1000;
const detailCacheKey = (source, id) => source + '::' + id;
const readDetailCache = (key) => {
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.ts < DETAIL_CACHE_TTL) return hit;
  if (hit) detailCache.delete(key);
  return null;
};

// ---------- 歌曲映射 (→ Auroradio 形状) ----------
const mapKwSong = (item) => {
  const songmid = String(item.id);
  return {
    provider: 'lx', source: 'lx', type: 'song', lxSource: 'kw',
    songmid, id: 'lx_kw_' + songmid,
    name: decodeName(item.name),
    artist: decodeName(item.artist),
    album: decodeName(item.album),
    cover: '', duration: (parseInt(item.duration) || 0) * 1000,
  };
};

const mapKgEnrichedSong = (item) => {
  if (!item || !item.audio_info) return null;
  const a = item.audio_info;
  const hash = a.hash || '';
  const songmid = String(a.audio_id || hash);
  const song = {
    provider: 'kugou', source: 'kugou', type: 'song',
    id: songmid, songmid,
    hash,
    name: decodeName(item.songname || item.ori_audio_name),
    artist: decodeName(item.author_name),
    album: decodeName(item.album_info && item.album_info.album_name),
    albumId: String((item.album_info && item.album_info.album_id) || ''),
    cover: '', duration: (parseInt(a.timelength) || 0),
  };
  return song;
};

const mapTxSong = (item) => {
  const album = item.album || {};
  const albumMid = album.mid || '';
  const file = item.file || {};
  return {
    provider: 'qq', source: 'qq', type: 'song',
    id: String(item.id || ''), songmid: item.mid || '', mid: item.mid || '',
    mediaMid: file.media_mid || '', albumMid,
    name: item.title || '',
    artist: Array.isArray(item.singer) ? item.singer.map((s) => decodeName(s.name)).filter(Boolean).join('、') : '',
    album: decodeName(album.name),
    cover: albumMid && albumMid !== '空'
      ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumMid + '.jpg' : '',
    duration: (Number(item.interval) || 0) * 1000,
  };
};

const mapWySong = (item) => ({
  provider: 'netease', source: 'netease', type: 'song',
  id: String(item.id), songmid: String(item.id),
  name: (item.pc && item.pc.sn) || item.name || '',
  artist: (item.pc && item.pc.ar) || (Array.isArray(item.ar) ? item.ar.map((a) => decodeName(a.name)).filter(Boolean).join('、') : ''),
  album: (item.al && item.al.name) || (item.pc && item.pc.alb) || '',
  albumId: String((item.al && item.al.id) || ''),
  cover: (item.al && item.al.picUrl) || '',
  duration: Number(item.dt) || 0,
});

const mapMgSong = (item) => {
  if (!item || !item.songId) return null;
  let img = item.img3 || item.img2 || item.img1 || '';
  if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;
  return {
    provider: 'lx', source: 'lx', type: 'song', lxSource: 'mg',
    songmid: String(item.songId), copyrightId: String(item.copyrightId || ''),
    id: 'lx_mg_' + item.copyrightId,
    name: decodeName(item.songName),
    artist: Array.isArray(item.singerList) ? item.singerList.map((s) => decodeName(s && s.name)).filter(Boolean).join('、') : '',
    album: decodeName(item.album),
    cover: img, duration: (Number(item.duration) || 0) * 1000,
  };
};

// ============================================================
// kw 酷我
// ============================================================
const kwSortList = [{ name: '最新', id: 'new' }, { name: '最热', id: 'hot' }];

async function kwTags() {
  const [tagsRes, hotRes] = await Promise.all([
    httpJson('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0&vipver=9.0.5.0&source=kwplayer_pc_9.0.5.0&loginUid=0&loginSid=0&appUid=76039576').catch(() => null),
    httpJson('http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmTagList?loginUid=0&loginSid=0&appUid=76039576').catch(() => null),
  ]);
  const tags = (tagsRes && tagsRes.code === 200 && Array.isArray(tagsRes.data) ? tagsRes.data : []).map((type) => ({
    name: type.name,
    list: (type.data || []).map((item) => ({ id: item.id + '-' + item.digest, name: item.name })),
  }));
  const hot = (hotRes && hotRes.code === 200 && Array.isArray(hotRes.data) && hotRes.data[0] && Array.isArray(hotRes.data[0].data)
    ? hotRes.data[0].data : []).map((item) => ({ id: item.id + '-' + item.digest, name: item.name }));
  return { sortList: kwSortList, tags, hot };
}

async function kwSquare({ tagId, sortId, page }) {
  let id = null;
  let type = null;
  if (tagId) {
    const arr = String(tagId).split('-');
    id = arr[0];
    type = arr[1];
  }
  let url;
  if (!id) {
    url = 'http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=' + page + '&rn=36&order=' + (sortId || 'new');
  } else if (type === '10000') {
    url = 'http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=' + page + '&id=' + id + '&rn=36';
  } else {
    url = 'http://mobileinterfaces.kuwo.cn/er.s?type=get_pc_qz_data&f=web&id=' + id + '&prod=pc';
  }
  const body = await httpJson(url);
  let lists = [];
  let total = 99999;
  if (!id || type === '10000') {
    const d = (body && body.data) || {};
    lists = (d.data || []).map((item) => ({
      source: 'kw', id: 'digest-' + item.digest + '__' + item.id, name: item.name,
      author: item.uname, cover: item.img, trackCount: item.total || 0,
      playCount: formatPlayCount(item.listencnt), desc: item.desc || '',
    }));
    total = Number(d.total) || lists.length;
  } else if (Array.isArray(body) && body.length) {
    (body || []).forEach((group) => {
      (group.list || []).forEach((item) => {
        if (!item.label) return;
        lists.push({
          source: 'kw', id: 'digest-' + item.digest + '__' + item.id, name: item.name,
          author: item.uname, cover: item.img, trackCount: item.total || 0,
          playCount: formatPlayCount(item.listencnt), desc: item.desc || '',
        });
      });
    });
  }
  return { lists, total, hasMore: lists.length >= 36 && page * 36 < total };
}

async function kwDetailTracks(id, page) {
  return httpJson('http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=' + id + '&pn=' + (page - 1) + '&rn=1000&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1');
}

async function kwDetail(rawId, page) {
  let id = String(rawId);
  if (/\/bodian\//.test(id)) throw new Error('暂不支持波点歌单链接');
  const linkMatch = /\/playlist(?:_detail)?\/(\d+)/.exec(id);
  if (/[?&:/]/.test(id) && linkMatch) id = linkMatch[1];
  else if (/^digest-/.test(id)) {
    const parts = id.split('__');
    const digest = parts[0].replace('digest-', '');
    id = parts[1];
    if (digest === '5') {
      // digest-5: 先换 sourceid
      const info = await httpJson('http://qukudata.kuwo.cn/q.k?op=query&cont=ninfo&node=' + id + '&pn=0&rn=1&fmt=json&src=mbox&level=2');
      id = (info && info.child && info.child.length && info.child[0].sourceid) || id;
    }
    // digest-8/13 及其它: 直接走 pl.svc (13 为专辑歌单, 可能失败)
  }
  const body = await kwDetailTracks(id, page);
  if (!body || body.result !== 'ok') throw new Error('酷我歌单详情获取失败');
  const total = Number(body.total) || (body.musiclist || []).length;
  return {
    info: {
      name: body.title || '', cover: body.pic || '', desc: body.info || '',
      author: body.uname || '', playCount: formatPlayCount(body.playnum),
    },
    tracks: (body.musiclist || []).map(mapKwSong).filter(Boolean),
    total,
    page,
    limit: 1000,
    hasMore: page * 1000 < total,
    nextOffset: page * 1000,
  };
}

// 酷我 r.s 接口返回单引号伪 JSON (非严格 JSON)，需宽松解析
function parseLooseJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  try { return (new Function('return (' + text + ')'))(); } catch (_) { return null; }
}

async function kwSearch(keywords, page, limit) {
  const url = 'http://search.kuwo.cn/r.s?all=' + encodeURIComponent(keywords) + '&pn=' + (page - 1) + '&rn=' + limit +
    '&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0';
  const raw = await httpRequest(url);
  const body = parseLooseJson(raw.text);
  if (!body) return { lists: [], total: 0, hasMore: false };
  const lists = ((body && body.abslist) || []).map((item) => ({
    source: 'kw', id: String(item.playlistid), name: decodeName(item.name),
    author: decodeName(item.nickname), cover: item.pic, trackCount: item.songnum || 0,
    playCount: formatPlayCount(item.playcnt), desc: decodeName(item.intro || ''),
  }));
  return { lists, total: parseInt(body && body.TOTAL) || lists.length, hasMore: lists.length >= limit };
}

// ============================================================
// kg 酷狗
// ============================================================
const kgSortList = [{ name: '推荐', id: '5' }, { name: '最热', id: '6' }, { name: '最新', id: '7' }, { name: '热藏', id: '3' }, { name: '飙升', id: '8' }];
const KG_WEB_KEY = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

const kgSignatureParams = (params, platform, body) => {
  const keyparam = platform === 'web' ? KG_WEB_KEY : 'OIlwieks28dk2k092lksi2UIkp';
  const paramList = params.split('&').sort();
  return md5(keyparam + paramList.join('') + (body || '') + keyparam);
};

async function kgTags() {
  const body = await httpJson('http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&');
  if (!body || body.status !== 1) return { sortList: kgSortList, tags: [], hot: [] };
  const hot = [];
  const hotRaw = (body.data && body.data.hotTag) || {};
  if (hotRaw.status === 1) {
    for (const key of Object.keys(hotRaw.data || {})) {
      hot.push({ id: String(hotRaw.data[key].special_id), name: hotRaw.data[key].special_name });
    }
  }
  const tags = [];
  const tagIds = (body.data && body.data.tagids) || {};
  for (const name of Object.keys(tagIds)) {
    tags.push({
      name,
      list: (tagIds[name].data || []).map((tag) => ({ id: String(tag.id), name: tag.name })),
    });
  }
  return { sortList: kgSortList, tags, hot };
}

async function kgSquare({ tagId, sortId, page }) {
  const url = 'http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=' + (sortId || '5') + '&c=' + (tagId || '') + '&p=' + page;
  const body = await httpJson(url);
  if (!body || body.status !== 1) throw new Error('酷狗歌单广场获取失败');
  const lists = ((body.special_db) || []).map((item) => ({
    source: 'kg', id: 'id_' + item.specialid, name: item.specialname,
    author: item.nickname, cover: item.img || item.imgurl, trackCount: item.songcount || 0,
    playCount: formatPlayCount(item.total_play_count || item.play_count), desc: item.intro || '',
  }));
  return { lists, total: 99999, hasMore: lists.length >= 30 };
}

// hash → 完整歌曲信息 (gateway 批量补全, 100/批)
async function kgEnrichHashes(hashes) {
  const unique = [];
  const seen = new Set();
  for (const h of hashes) {
    if (!h || seen.has(h)) continue;
    seen.add(h);
    unique.push(h);
  }
  const DBG = process.env.LX_SL_DEBUG === '1';
  if (DBG) console.log('[kgDebug] hashes in:', hashes.length, 'unique:', unique.length);
  const base = {
    area_code: '1', show_privilege: 1, show_album_info: '1', is_publish: '',
    appid: 1005, clientver: 11451, mid: '1', dfid: '-', clienttime: Date.now(),
    key: 'OIlwieks28dk2k092lksi2UIkp',
    fields: 'album_info,author_name,audio_info,ori_audio_name,base,songname',
  };
  const tasks = [];
  for (let i = 0; i < unique.length; i += 100) {
    tasks.push(Object.assign({}, base, { data: unique.slice(i, i + 100).map((h) => ({ hash: h })) }));
  }
  const results = await Promise.all(tasks.map((task) => (async () => {
    // gateway 偶发返回全空, 最多重试 2 次
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await httpRequest('http://gateway.kugou.com/v2/album_audio/audio', {
        method: 'post',
        headers: {
          'KG-THash': '13a3164', 'KG-RC': '1', 'KG-Fake': '0', 'KG-RF': '00869891',
          'User-Agent': 'Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi',
          'x-router': 'kmr.service.kugou.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      });
      let parsed = null;
      try { parsed = JSON.parse(res.text); } catch (_) { }
      if (DBG) console.log('[kgDebug] first hash:', task.data[0] && task.data[0].hash, '| resp head:', res.text.slice(0, 160));
      if (parsed && parsed.status === 1 && Array.isArray(parsed.data)) {
        const out = parsed.data.map((s) => {
          const items = Array.isArray(s) ? s : (s ? [s] : []);
          for (const item of items) {
            if (item && item.audio_info) return item;
          }
          return null;
        });
        if (DBG) console.log('[kgDebug] batch mapped:', out.filter(Boolean).length, '/', out.length, '(attempt', attempt + 1 + ')');
        if (out.filter(Boolean).length || attempt === 2) return out;
        continue; // 全空 → 重试
      }
    }
    return [];
  })().catch(() => [])));
  return results.flat();
}

const kgFilterEnriched = (rawList) => {
  const ids = new Set();
  const list = [];
  rawList.forEach((item) => {
    if (!item || !item.audio_info) return;
    if (ids.has(item.audio_info.audio_id)) return;
    ids.add(item.audio_info.audio_id);
    const song = mapKgEnrichedSong(item);
    if (song && song.name) list.push(song);
  });
  return list;
};

async function kgDetailBySpecialId(specialId) {
  const cached = readDetailCache(detailCacheKey('kg', specialId));
  if (cached) return cached;
  const res = await httpRequest('http://www2.kugou.kugou.com/yueku/v9/special/single/' + specialId + '-5-9999.html');
  const match = /global\.data = (\[.+\]);/.exec(res.text);
  if (!match) throw new Error('酷狗歌单解析失败');
  const hashData = JSON.parse(match[1]);
  const nameMatch = /global = {[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?};/.exec(res.text);
  const enriched = await kgEnrichHashes(hashData.map((item) => item && item.hash));
  const tracks = kgFilterEnriched(enriched);
  const info = {
    name: nameMatch ? decodeName(nameMatch[1]) : '',
    cover: nameMatch ? nameMatch[2] : '',
    desc: '', author: '', playCount: '',
  };
  const out = { info, tracks, total: tracks.length };
  if (tracks.length) detailCache.set(detailCacheKey('kg', specialId), Object.assign({ ts: Date.now() }, out));
  return out;
}

async function kgDetailByGlobalId(gcid) {
  const key = detailCacheKey('kg', gcid);
  const cached = readDetailCache(key);
  if (cached) return cached;
  if (gcid.length > 1000) throw new Error('get list error');
  const infoParams = 'appid=1058&specialid=0&global_specialid=' + gcid + '&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-';
  const infoHeaders = {
    mid: '1586163242519', Referer: 'https://m3ws.kugou.com/share/index.php',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
    dfid: '-', clienttime: '1586163242519',
  };
  const infoRes = await httpJson('https://mobiles.kugou.com/api/v5/special/info_v2?' + infoParams + '&signature=' + kgSignatureParams(infoParams, 'web'), { headers: infoHeaders });
  const songCount = Number(infoRes && infoRes.songcount) || 0;
  const pages = [];
  let remaining = songCount;
  let pageNo = 0;
  while (remaining > 0) {
    const limit = remaining > 300 ? 300 : remaining;
    remaining -= limit;
    pageNo += 1;
    const params = 'appid=1058&global_specialid=' + gcid + '&specialid=0&plat=0&version=8000&page=' + pageNo + '&pagesize=' + limit + '&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-';
    pages.push(
      httpJson('https://mobiles.kugou.com/api/v5/special/song_v2?' + params + '&signature=' + kgSignatureParams(params, 'web'), { headers: infoHeaders })
        .then((data) => (data && Array.isArray(data.info)) ? data.info : [])
        .catch(() => []),
    );
  }
  const pageResults = await Promise.all(pages);
  const hashInfos = pageResults.flat();
  const enriched = await kgEnrichHashes(hashInfos.map((item) => item && item.hash));
  const tracks = kgFilterEnriched(enriched);
  const info = {
    name: (infoRes && infoRes.specialname) || '',
    cover: (infoRes && infoRes.imgurl && String(infoRes.imgurl).replace('{size}', 240)) || '',
    desc: (infoRes && infoRes.intro) || '',
    author: (infoRes && infoRes.nickname) || '',
    playCount: formatPlayCount(infoRes && infoRes.playcount),
  };
  const out = { info, tracks, total: tracks.length };
  if (tracks.length) detailCache.set(key, Object.assign({ ts: Date.now() }, out));
  return out;
}

async function kgDetail(rawId, page) {
  let id = String(rawId);
  let full;
  if (/special\/single\//.test(id)) {
    id = id.replace(/^.+\/(\d+)\.html.*$/, '$1');
    full = await kgDetailBySpecialId(id);
  } else if (/^https?:/.test(id)) {
    const gcidMatch = /global_collection_id=(\w+)/.exec(id);
    if (gcidMatch) full = await kgDetailByGlobalId(gcidMatch[1]);
    else {
      const singleMatch = /\/(\d+)\.html/.exec(id);
      if (singleMatch) full = await kgDetailBySpecialId(singleMatch[1]);
      else throw new Error('暂不支持该酷狗链接格式');
    }
  } else if (/^gcid_/.test(id)) {
    const params = 'dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-';
    const body = { ret_info: 1, data: [{ id, id_type: 2 }] };
    const result = await httpJson('https://t.kugou.com/v1/songlist/batch_decode?' + params + '&signature=' + kgSignatureParams(params, 'android', JSON.stringify(body)), {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HUAWEI HMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36',
        Referer: 'https://m.kugou.com/',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const gcid2 = result && result.list && result.list[0] && result.list[0].global_collection_id;
    if (!gcid2) throw new Error('gcid 解析失败');
    full = await kgDetailByGlobalId(gcid2);
  } else if (/^\d+$/.test(id)) {
    // 酷狗码 / 纯数字
    const songInfo = await httpJson('http://t.kugou.com/command/', {
      method: 'post',
      headers: { 'KG-RC': 1, 'KG-THash': 'network_super_call.cpp:3676261689:379', 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: 1001, clientver: 9020, mid: '21511157a05844bd085308bc76ef3343', clienttime: 640612895, key: '36164c4015e704673c588ee202b9ecb8', data: id }),
    });
    const info = (songInfo && songInfo.info) || {};
    if (info.global_collection_id) full = await kgDetailByGlobalId(info.global_collection_id);
    else if (info.id) full = await kgDetailBySpecialId(String(info.id));
    else throw new Error('酷狗码解析失败');
  } else if (/^id_/.test(id)) {
    full = await kgDetailBySpecialId(id.replace('id_', ''));
  } else {
    full = await kgDetailBySpecialId(id);
  }
  const limit = 50;
  const start = (page - 1) * limit;
  const tracks = full.tracks.slice(start, start + limit);
  return {
    info: full.info, tracks, total: full.total, page, limit,
    hasMore: start + limit < full.total, nextOffset: start + limit,
  };
}

async function kgSearch(keywords, page, limit) {
  const url = 'http://msearchretry.kugou.com/api/v3/search/special?keyword=' + encodeURIComponent(keywords) + '&page=' + page + '&pagesize=' + limit + '&showtype=10&filter=0&version=7910&sver=2';
  const body = await httpJson(url);
  if (!body || body.errcode != 0) throw new Error('酷狗歌单搜索失败');
  const lists = (((body.data || {}).info) || []).map((item) => ({
    source: 'kg', id: 'id_' + item.specialid, name: item.specialname,
    author: item.nickname, cover: item.imgurl, trackCount: item.songcount || 0,
    playCount: formatPlayCount(item.playcount), desc: item.intro || '',
  }));
  return { lists, total: Number(body.data.total) || lists.length, hasMore: lists.length >= limit };
}

// ============================================================
// tx QQ 音乐
// ============================================================
const txSortList = [{ name: '最热', id: '5' }, { name: '最新', id: '2' }];

const txMusicu = (data, extraHeaders) => httpJson('https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=' + encodeURIComponent(JSON.stringify(data)), { headers: extraHeaders || {} });

async function txTags() {
  const body = await txMusicu({ tags: { method: 'get_all_categories', param: { qq: '' }, module: 'playlist.PlaylistAllCategoriesServer' } });
  const tags = (body && body.code === 0 && body.tags && body.tags.data && Array.isArray(body.tags.data.v_group))
    ? body.tags.data.v_group.map((type) => ({
      name: type.group_name,
      list: (type.v_item || []).map((item) => ({ id: String(item.id), name: item.name })),
    }))
    : [];
  return { sortList: txSortList, tags, hot: [] };
}

async function txSquare({ tagId, sortId, page }) {
  let data;
  if (tagId) {
    data = {
      comm: { cv: 1602, ct: 20 },
      playlist: {
        method: 'get_category_content',
        param: { titleid: parseInt(tagId), caller: '0', category_id: parseInt(tagId), size: 36, page: page - 1, use_page: 1 },
        module: 'playlist.PlayListCategoryServer',
      },
    };
  } else {
    data = {
      comm: { cv: 1602, ct: 20 },
      playlist: {
        method: 'get_playlist_by_tag',
        param: { id: 10000000, sin: 36 * (page - 1), size: 36, order: sortId || 5, cur_page: page },
        module: 'playlist.PlayListPlazaServer',
      },
    };
  }
  const body = await txMusicu(data);
  if (!body || body.code !== 0) throw new Error('QQ歌单广场获取失败');
  const d = body.playlist && body.playlist.data;
  if (!d) throw new Error('QQ歌单广场获取失败');
  let lists;
  let total;
  if (tagId) {
    lists = (((d.content || {}).v_item) || []).map(({ basic }) => ({
      source: 'tx', id: String(basic.tid), name: basic.title,
      author: basic.creator && basic.creator.nick, cover: (basic.cover && (basic.cover.medium_url || basic.cover.default_url)) || '',
      trackCount: 0, playCount: formatPlayCount(basic.play_cnt), desc: decodeName(basic.desc || '').replace(/<br>/g, '\n'),
    }));
    total = d.content ? Number(d.content.total_cnt) || lists.length : lists.length;
  } else {
    lists = ((d.v_playlist) || []).map((item) => ({
      source: 'tx', id: String(item.tid), name: item.title,
      author: item.creator_info && item.creator_info.nick, cover: item.cover_url_medium,
      trackCount: (item.song_ids || []).length || 0, playCount: formatPlayCount(item.access_num),
      desc: decodeName(item.desc || '').replace(/<br>/g, '\n'),
    }));
    total = Number(d.total) || lists.length;
  }
  return { lists, total, hasMore: page * 36 < total };
}

async function txDetail(rawId, page) {
  const key = detailCacheKey('tx', rawId);
  let full = readDetailCache(key);
  if (!full) {
    let id = String(rawId);
    if (/[?&:/]/.test(id)) {
      let m = /\/playlist\/(\d+)/.exec(id);
      if (!m) m = /id=(\d+)/.exec(id);
      if (m) id = m[1];
      else throw new Error('无法解析 QQ 歌单 ID');
    }
    const res = await httpRequest('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=' + id + '&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0', {
      headers: { Origin: 'https://y.qq.com', Referer: 'https://y.qq.com/n/yqq/playsquare/' + id + '.html' },
    });
    const body = JSON.parse(res.text);
    if (!body || body.code !== 0 || !Array.isArray(body.cdlist) || !body.cdlist[0]) throw new Error('QQ歌单详情获取失败');
    const cdlist = body.cdlist[0];
    full = {
      info: {
        name: cdlist.dissname || '', cover: cdlist.logo || '',
        desc: decodeName(cdlist.desc || '').replace(/<br>/g, '\n'),
        author: cdlist.nickname || '', playCount: formatPlayCount(cdlist.visitnum),
      },
      tracks: (cdlist.songlist || []).map(mapTxSong).filter((s) => s && s.songmid),
      total: (cdlist.songlist || []).length,
    };
    if (full.tracks.length) detailCache.set(key, Object.assign({ ts: Date.now() }, full));
  }
  const limit = 100;
  const start = (page - 1) * limit;
  const tracks = full.tracks.slice(start, start + limit);
  return {
    info: full.info, tracks, total: full.total, page, limit,
    hasMore: start + limit < full.total, nextOffset: start + limit,
  };
}

async function txSearch(keywords, page, limit) {
  const url = 'http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=' + (page - 1) + '&num_per_page=' + limit + '&format=json&query=' + encodeURIComponent(keywords) + '&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8';
  const body = await httpJson(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      Referer: 'http://y.qq.com/portal/search.html',
    },
  });
  if (!body || body.code != 0) throw new Error('QQ歌单搜索失败');
  const lists = ((body.data || {}).list || []).map((item) => ({
    source: 'tx', id: String(item.dissid), name: decodeName(item.dissname),
    author: decodeName(item.creator && item.creator.name), cover: item.imgurl,
    trackCount: item.song_count || 0, playCount: formatPlayCount(item.listennum),
    desc: decodeName(decodeName(item.introduction || '')).replace(/<br>/g, '\n'),
  }));
  return { lists, total: Number(body.data.sum) || lists.length, hasMore: lists.length >= limit };
}

// ============================================================
// wy 网易云 (weapi / linuxapi / eapi)
// ============================================================
const wySortList = [{ name: '最热', id: 'hot' }];
const WY_IV = Buffer.from('0102030405060708');
const WY_PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud');
const WY_LINUXAPI_KEY = Buffer.from('rFgB&h#%2?^eDg:Q');
const WY_EAPI_KEY = 'e82ckenh8dichen8';
const WY_BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const WY_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';

const wyAesEncrypt = (buffer, mode, key, iv) => {
  const cipher = crypto.createCipheriv(mode, key, iv);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
};

const wyWeapi = (object) => {
  const text = JSON.stringify(object);
  const secretKey = crypto.randomBytes(16).map((n) => WY_BASE62.charCodeAt(n % 62));
  return {
    params: wyAesEncrypt(Buffer.from(wyAesEncrypt(Buffer.from(text), 'aes-128-cbc', WY_PRESET_KEY, WY_IV).toString('base64')), 'aes-128-cbc', secretKey, WY_IV).toString('base64'),
    encSecKey: (() => {
      const buf = Buffer.concat([Buffer.alloc(128 - secretKey.length), secretKey.reverse()]);
      return crypto.publicEncrypt({ key: WY_PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING }, buf).toString('hex');
    })(),
  };
};

const wyLinuxapi = (object) => {
  const text = JSON.stringify(object);
  return {
    eparams: wyAesEncrypt(Buffer.from(text), 'aes-128-ecb', WY_LINUXAPI_KEY, '').toString('hex').toUpperCase(),
  };
};

const wyEapi = (urlPath, object) => {
  const text = JSON.stringify(object);
  const message = 'nobody' + urlPath + 'use' + text + 'md5forencrypt';
  const digest = crypto.createHash('md5').update(message).digest('hex');
  const data = urlPath + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest;
  return wyAesEncrypt(Buffer.from(data), 'aes-128-ecb', Buffer.from(WY_EAPI_KEY), '').toString('hex').toUpperCase();
};

const wyWeapiPost = (url, data) => {
  const enc = wyWeapi(data);
  return httpJson(url, {
    method: 'post',
    headers: { 'User-Agent': DEFAULT_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'params=' + encodeURIComponent(enc.params) + '&encSecKey=' + encodeURIComponent(enc.encSecKey),
  });
};

const wyEapiPost = (urlPath, data) => {
  const params = wyEapi(urlPath, data);
  return httpJson('http://interface.music.163.com/eapi/batch', {
    method: 'post',
    headers: { origin: 'https://music.163.com', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'params=' + encodeURIComponent(params),
  });
};

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36';

async function wyTags() {
  const [catRes, hotRes] = await Promise.all([
    wyWeapiPost('https://music.163.com/weapi/playlist/catalogue', {}).catch(() => null),
    wyWeapiPost('https://music.163.com/weapi/playlist/hottags', {}).catch(() => null),
  ]);
  let tags = [];
  if (catRes && catRes.code === 200) {
    const subMap = {};
    for (const item of (catRes.sub || [])) {
      if (!subMap[item.category]) subMap[item.category] = [];
      subMap[item.category].push({ id: item.name, name: item.name });
    }
    tags = Object.keys(catRes.categories || {}).map((key) => ({
      name: catRes.categories[key],
      list: subMap[key] || [],
    })).filter((g) => g.list.length);
  }
  const hot = (hotRes && hotRes.code === 200 && Array.isArray(hotRes.tags)
    ? hotRes.tags.map((item) => ({ id: item.playlistTag.name, name: item.playlistTag.name }))
    : []);
  return { sortList: wySortList, tags, hot };
}

const wyFilterPlaylist = (rawList) => (rawList || []).map((item) => ({
  source: 'wy', id: String(item.id), name: item.name,
  author: item.creator && item.creator.nickname, cover: item.coverImgUrl,
  trackCount: item.trackCount || 0, playCount: formatPlayCount(item.playCount),
  desc: item.description || '',
}));

async function wySquare({ tagId, sortId, page }) {
  const body = await wyWeapiPost('https://music.163.com/weapi/playlist/list', {
    cat: tagId || '全部',
    order: sortId || 'hot',
    limit: 30,
    offset: 30 * (page - 1),
    total: true,
  });
  if (!body || body.code !== 200) throw new Error('网易云歌单广场获取失败');
  const lists = wyFilterPlaylist(body.playlists);
  return { lists, total: parseInt(body.total) || lists.length, hasMore: lists.length >= 30 };
}

// 灰色歌曲兜底: 按 trackIds 批量拉取完整歌曲信息 (weapi v3/song/detail)
async function wyFetchSongDetails(trackIds) {
  const songs = [];
  for (let i = 0; i < trackIds.length; i += 200) {
    const ids = trackIds.slice(i, i + 200);
    const body = await wyWeapiPost('https://music.163.com/weapi/v3/song/detail', {
      c: '[' + ids.map((id) => ('{"id":' + id + '}')).join(',') + ']',
      ids: '[' + ids.join(',') + ']',
    }).catch(() => null);
    if (!body || body.code !== 200) continue;
    for (const song of (body.songs || [])) songs.push(song);
  }
  return songs;
}

async function wyDetail(rawId, page) {
  const key = detailCacheKey('wy', rawId);
  let full = readDetailCache(key);
  if (!full) {
    let id = String(rawId);
    if (/[?&:/]/.test(id)) {
      let m = /[?&]id=(\d+)/.exec(id);
      if (!m) m = /\/playlist\/(\d+)/.exec(id);
      if (m) id = m[1];
      else throw new Error('无法解析网易云歌单 ID');
    }
    const enc = wyLinuxapi({
      method: 'POST',
      url: 'https://music.163.com/api/v3/playlist/detail',
      params: { id, n: 100000, s: 8 },
    });
    const body = await httpJson('https://music.163.com/api/linux/forward', {
      method: 'post',
      headers: {
        'User-Agent': DEFAULT_UA,
        Cookie: 'MUSIC_U=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'eparams=' + encodeURIComponent(enc.eparams),
    });
    if (!body || body.code !== 200 || !body.playlist) throw new Error('网易云歌单详情获取失败');
    const privileges = body.privileges || [];
    let trackList = body.playlist.tracks || [];
    const trackIds = (body.playlist.trackIds || []).map((t) => t.id);
    // 未登录时接口可能只返回部分 tracks, 用 v3/song/detail 按 trackIds 补全
    if (trackList.length < trackIds.length && trackIds.length) {
      const fetched = await wyFetchSongDetails(trackIds.slice(0, 1000));
      if (fetched.length > trackList.length) trackList = fetched;
    }
    full = {
      info: {
        name: body.playlist.name || '', cover: body.playlist.coverImgUrl || '',
        desc: body.playlist.description || '',
        author: (body.playlist.creator && body.playlist.creator.nickname) || '',
        playCount: formatPlayCount(body.playlist.playCount),
      },
      tracks: trackList.map((item) => mapWySong(item)).filter(Boolean),
      total: trackIds.length || trackList.length,
    };
    detailCache.set(key, Object.assign({ ts: Date.now() }, full));
  }
  const limit = 100;
  const start = (page - 1) * limit;
  const tracks = full.tracks.slice(start, start + limit);
  return {
    info: full.info, tracks, total: full.total, page, limit,
    hasMore: start + limit < full.total, nextOffset: start + limit,
  };
}

async function wySearch(keywords, page, limit) {
  const body = await wyEapiPost('/api/cloudsearch/pc', {
    s: keywords, type: 1000, limit, total: page === 1, offset: limit * (page - 1),
  });
  if (!body || body.code !== 200) throw new Error('网易云歌单搜索失败');
  const lists = wyFilterPlaylist((body.result || {}).playlists);
  return { lists, total: Number((body.result || {}).playlistCount) || lists.length, hasMore: lists.length >= limit };
}

// ============================================================
// mg 咪咕
// ============================================================
const mgSortList = [{ name: '推荐', id: '15127315' }];

async function mgTags() {
  const body = await httpJson('https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release', { headers: MG_HEADERS });
  if (!body || body.code !== '000000' || !Array.isArray(body.data) || !body.data.length) {
    return { sortList: mgSortList, tags: [], hot: [] };
  }
  const hot = (body.data[0].content || []).map((item) => {
    const texts = item.texts || [];
    return { id: String(texts[1]), name: texts[0] };
  }).filter((t) => t.name);
  const tags = body.data.slice(1).map((group) => ({
    name: group.header && group.header.title,
    list: (group.content || []).map((item) => {
      const texts = item.texts || [];
      return { id: String(texts[1]), name: texts[0] };
    }).filter((t) => t.name),
  }));
  return { sortList: mgSortList, tags, hot };
}

const mgFilterListByTag = (listData, list, ids) => {
  list = list || [];
  ids = ids || new Set();
  for (const item of listData || []) {
    if (item.contents) mgFilterListByTag(item.contents, list, ids);
    else if (item.resType == '2021' && !ids.has(item.resId)) {
      ids.add(item.resId);
      list.push({
        source: 'mg', id: String(item.resId), name: item.txt,
        author: '', cover: item.img, trackCount: 0,
        playCount: '', desc: item.txt2 || '',
      });
    }
  }
  return list;
};

async function mgSquare({ tagId, sortId, page }) {
  const url = !tagId
    ? 'https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=' + page
    : 'https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=' + page + '&templateVersion=2&tagId=' + tagId;
  const body = await httpJson(url, { headers: MG_HEADERS });
  if (!body || body.code !== '000000') throw new Error('咪咕歌单广场获取失败');
  const lists = body.data.contents
    ? mgFilterListByTag(body.data.contents)
    : (((body.data.contentItemList || [])[1] || {}).itemList || []).map((item) => ({
      source: 'mg', id: String(item.logEvent && item.logEvent.contentId), name: item.title,
      author: '', cover: item.imageUrl, trackCount: 0,
      playCount: (item.barList && item.barList[0] && item.barList[0].title) || '', desc: '',
    }));
  return { lists, total: 99999, hasMore: lists.length >= 20 };
}

async function mgDetail(rawId, page) {
  let id = String(rawId);
  if (/\/playlist[/?]/.test(id) || /playlistId=/i.test(id)) {
    const m = /(?:playlistId|id)=(\d+)/i.exec(id);
    if (!m) throw new Error('无法解析咪咕歌单 ID');
    id = m[1];
  } else {
    const m = /\/playlist\/(\d+)/.exec(id);
    if (m) id = m[1];
  }
  const limit = 50;
  const [songRes, infoRes] = await Promise.all([
    httpJson('https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=' + page + '&pageSize=' + limit + '&playlistId=' + id, { headers: MG_HEADERS }),
    httpJson('https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=' + id, { headers: MG_HEADERS }).catch(() => null),
  ]);
  if (!songRes || songRes.code !== '000000') throw new Error('咪咕歌单详情获取失败');
  const info = infoRes && infoRes.code === '000000' ? {
    name: (infoRes.data && infoRes.data.title) || '',
    cover: (infoRes.data && infoRes.data.imgItem && infoRes.data.imgItem.img) || '',
    desc: (infoRes.data && infoRes.data.summary) || '',
    author: (infoRes.data && infoRes.data.ownerName) || '',
    playCount: formatPlayCount(infoRes.data && infoRes.data.opNumItem && infoRes.data.opNumItem.playNum),
  } : { name: '', cover: '', desc: '', author: '', playCount: '' };
  const tracks = ((songRes.data || {}).songList || []).map(mapMgSong).filter(Boolean);
  const total = Number((songRes.data || {}).totalCount) || tracks.length;
  return {
    info, tracks, total, page, limit,
    hasMore: page * limit < total, nextOffset: page * limit,
  };
}

async function mgSearch(keywords, page, limit) {
  const timeStr = Date.now().toString();
  const sign = md5(keywords + '6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50' + '963B7AA0D21511ED807EE5846EC87D20' + timeStr);
  const url = 'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1' +
    '&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1%2C%22lyricSong%22%3A0%7D' +
    '&pageSize=' + limit + '&text=' + encodeURIComponent(keywords) + '&pageNo=' + page + '&sort=0&sid=USS';
  const body = await httpJson(url, {
    headers: {
      uiVersion: 'A_music_3.6.1',
      deviceId: '963B7AA0D21511ED807EE5846EC87D20',
      timestamp: timeStr,
      sign,
      channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    },
  });
  if (!body || !body.songListResultData) throw new Error('咪咕歌单搜索失败');
  const lists = ((body.songListResultData.result) || []).map((item) => ({
    source: 'mg', id: String(item.id), name: item.name,
    author: item.userName || '', cover: item.musicListPicUrl,
    trackCount: item.musicNum || 0,
    playCount: isNaN(parseInt(item.playNum)) ? '' : formatPlayCount(parseInt(item.playNum)),
    desc: '',
  }));
  return { lists, total: parseInt(body.songListResultData.totalCount) || lists.length, hasMore: lists.length >= limit };
}

// ============================================================
// 统一入口
// ============================================================
const PLATFORMS = {
  kw: { tags: kwTags, square: kwSquare, detail: kwDetail, search: kwSearch, sortList: kwSortList },
  kg: { tags: kgTags, square: kgSquare, detail: kgDetail, search: kgSearch, sortList: kgSortList },
  tx: { tags: txTags, square: txSquare, detail: txDetail, search: txSearch, sortList: txSortList },
  wy: { tags: wyTags, square: wySquare, detail: wyDetail, search: wySearch, sortList: wySortList },
  mg: { tags: mgTags, square: mgSquare, detail: mgDetail, search: mgSearch, sortList: mgSortList },
};

const parseSourceList = (source) => {
  if (source && source !== 'all' && PLATFORMS[source]) return [source];
  return Object.keys(PLATFORMS);
};

async function getSongListTags({ source }) {
  const p = PLATFORMS[source];
  if (!p) throw new Error('unknown source');
  return p.tags();
}

async function getSongListSquare({ source, tagId, sortId, page }) {
  const p = PLATFORMS[source];
  if (!p) throw new Error('unknown source');
  const r = await p.square({ tagId: tagId || '', sortId: sortId || '', page: Math.max(1, Number(page) || 1) });
  return Object.assign({ source, sortList: p.sortList }, r);
}

async function searchSongList({ source, keywords, page, limit }) {
  keywords = String(keywords || '').trim();
  if (!keywords) return { source: source || 'all', lists: [], total: 0, hasMore: false };
  limit = Math.min(30, Math.max(5, Number(limit) || 15));
  page = Math.max(1, Number(page) || 1);
  const targets = parseSourceList(source);
  const results = await Promise.allSettled(targets.map((s) => PLATFORMS[s].search(keywords, page, limit)));
  const lists = [];
  let total = 0;
  const errors = [];
  results.forEach((entry, index) => {
    if (entry.status === 'fulfilled') {
      lists.push(...entry.value.lists);
      total += entry.value.total;
    } else {
      errors.push(targets[index] + ': ' + (entry.reason && entry.reason.message || 'failed'));
    }
  });
  return {
    source: source || 'all',
    lists,
    total,
    hasMore: lists.length > 0 && errors.length < targets.length,
    errors: errors.length ? errors : undefined,
  };
}

async function getSongListDetail({ source, id, page }) {
  const p = PLATFORMS[source];
  if (!p) throw new Error('unknown source');
  return p.detail(String(id || ''), Math.max(1, Number(page) || 1));
}

// offset/limit 切片 (供播放队列流式补全; kw/mg 原生分页换算, kg/tx/wy 全量缓存切片)
async function getSongListDetailSliced({ source, id, offset, limit }) {
  limit = Math.min(200, Math.max(10, Number(limit) || 50));
  offset = Math.max(0, Number(offset) || 0);
  let r;
  let start = 0;
  if (source === 'kw') {
    const page = Math.floor(offset / 1000) + 1;
    r = await kwDetail(id, page);
    start = offset - (page - 1) * 1000;
  } else if (source === 'mg') {
    const page = Math.floor(offset / 50) + 1;
    r = await mgDetail(id, page);
    start = offset - (page - 1) * 50;
  } else {
    r = await PLATFORMS[source].detail(String(id || ''), 1);
    start = offset;
  }
  const tracks = (r.tracks || []).slice(start, start + limit);
  const total = Number(r.total) || (r.tracks || []).length;
  return {
    info: r.info || {},
    tracks,
    total,
    hasMore: offset + tracks.length < total,
    nextOffset: offset + tracks.length,
    playlist: { name: (r.info || {}).name || '', cover: (r.info || {}).cover || '', trackCount: total },
  };
}

// ---------- 分享链接导入 (多平台歌单链接 → 曲目列表, 供 /api/playlist/from-share) ----------
// 各平台 detail 已支持直接传 URL 自行提取 ID; 这里只做平台识别 + 分页拉全
const SHARE_SOURCE_HOSTS = [
  [/music\.163\.com/i, 'wy'],
  [/y\.qq\.com/i, 'tx'],
  [/kugou\.com/i, 'kg'],
  [/kuwo\.cn/i, 'kw'],
  [/migu\.cn/i, 'mg'],
];

function songListSourceFromUrl(url) {
  const u = String(url || '');
  for (const [re, source] of SHARE_SOURCE_HOSTS) {
    if (re.test(u)) return source;
  }
  return '';
}

const SHARE_IMPORT_TRACK_CAP = 2000;

// source: 平台标识; id: 分享链接或纯 ID (detail 函数自行解析)
async function importSongListFromShare({ source, id }) {
  const p = PLATFORMS[source];
  if (!p) {
    const err = new Error('不支持的歌单平台: ' + source);
    err.code = 'UNKNOWN_PLATFORM';
    throw err;
  }
  const first = await getSongListDetail({ source, id });
  const tracks = (first.tracks || []).slice();
  const total = Number(first.total) || tracks.length;
  let page = Number(first.page) || 1;
  while (first.hasMore && tracks.length < SHARE_IMPORT_TRACK_CAP && tracks.length < total) {
    page += 1;
    const r = await getSongListDetail({ source, id, page });
    if (!r.tracks || !r.tracks.length) break;
    tracks.push(...r.tracks);
  }
  if (tracks.length > SHARE_IMPORT_TRACK_CAP) tracks.length = SHARE_IMPORT_TRACK_CAP;
  const m = /(?:[?&]id=|\/playlist(?:_detail)?\/|\/playsquare\/|\/special\/single\/|\/global_collection_id\/)(\d+)/.exec(String(id)) || [];
  return {
    success: true,
    source,
    playlist: {
      id: m[1] || id,
      title: (first.info || {}).name || '',
      cover: (first.info || {}).cover || '',
      total,
    },
    tracks,
    partial: total > tracks.length,
    message: total > tracks.length ? ('歌单共 ' + total + ' 首，当前导入 ' + tracks.length + ' 首') : '',
  };
}

module.exports = { getSongListTags, getSongListSquare, searchSongList, getSongListDetail, getSongListDetailSliced, songListSourceFromUrl, importSongListFromShare };
