'use strict';

// 落雪五平台免登录搜索（移植自 lyswhut/lx-music-desktop src/renderer/utils/musicSdk，Apache-2.0）
// Copyright (C) lx-music-desktop authors — https://github.com/lyswhut/lx-music-desktop
// kw 酷我 / kg 酷狗 / tx QQ / wy 网易云 / mg 咪咕
// 输出统一为 Auroradio 歌曲形状: wy→netease, kg→kugou, tx→qq (可直接播放);
// kw/mg → provider:'lx' 由自定义音源脚本解析播放
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36';

// ---------- 通用工具 (对齐 lx musicSdk helpers) ----------
const md5 = (str) => crypto.createHash('md5').update(str).digest('hex');

const decodeName = (str) => String(str == null ? '' : str)
  .replace(/<em>/g, '')
  .replace(/<\/em>/g, '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .trim();

const formatPlayTime = (time) => {
  const sec = Math.max(0, Math.round(Number(time) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
};

const lxIntervalToMs = (interval) => {
  const v = String(interval || '');
  if (!v) return 0;
  if (v.includes(':')) {
    const parts = v.split(':').map(Number).reverse();
    return parts.reduce((acc, p, i) => acc + (p || 0) * Math.pow(60, i), 0) * 1000;
  }
  const sec = Number(v);
  return isFinite(sec) ? Math.round(sec * 1000) : 0;
};

const formatSingerName = (list, key) => {
  if (!Array.isArray(list)) return '';
  return list.map((item) => decodeName(typeof item === 'string' ? item : (item || {})[key || 'name'])).filter(Boolean).join('、');
};

const sizeFormate = (size) => {
  let s = Number(size) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i += 1; }
  return (i === 0 ? s : s.toFixed(1)) + ' ' + units[i];
};

// ---------- HTTP ----------
function httpRequest(url, options, redirectCount) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'get',
      headers: Object.assign({ 'User-Agent': DEFAULT_UA, 'Accept-Encoding': 'identity' }, options.headers || {}),
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirectCount || 0) < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpRequest(next, options, (redirectCount || 0) + 1));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
          else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
        } catch (_) { /* 原样使用 */ }
        resolve({ statusCode: res.statusCode, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('request timeout')));
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

async function httpJson(url, options) {
  const result = await httpRequest(url, options);
  let body;
  try { body = JSON.parse(result.text); } catch (_) { throw new Error('响应不是有效 JSON (HTTP ' + result.statusCode + ')'); }
  return body;
}

// ---------- kw 酷我 ----------
async function searchKw(keywords, page, limit) {
  const url = 'http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(keywords) +
    '&pn=' + (page - 1) + '&rn=' + limit +
    '&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1';
  const result = await httpJson(url);
  const rawList = (result && result.abslist) || [];
  const songs = rawList.map((info) => {
    if (!info || !info.MUSICRID) return null;
    const songmid = String(info.MUSICRID).replace('MUSIC_', '');
    const intervalSec = parseInt(info.DURATION);
    return {
      provider: 'lx', source: 'lx', type: 'song',
      lxSource: 'kw',
      songmid,
      id: 'lx_kw_' + songmid,
      name: decodeName(info.SONGNAME),
      artist: decodeName(info.ARTIST),
      album: info.ALBUM ? decodeName(info.ALBUM) : '',
      cover: '',
      duration: Number.isNaN(intervalSec) ? 0 : intervalSec * 1000,
    };
  }).filter(Boolean);
  const total = parseInt(result && result.TOTAL) || songs.length;
  return { songs, total };
}

// ---------- kg 酷狗 ----------
async function searchKg(keywords, page, limit) {
  const url = 'https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent(keywords) +
    '&page=' + page + '&pagesize=' + limit +
    '&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1';
  const result = await httpJson(url);
  if (!result || result.error_code !== 0 || !result.data) return { songs: [], total: 0 };
  const seen = new Set();
  const songs = [];
  const pushRow = (rawData) => {
    if (!rawData || !rawData.Audioid) return;
    const key = rawData.Audioid + rawData.FileHash;
    if (seen.has(key)) return;
    seen.add(key);
    songs.push({
      provider: 'kugou', source: 'kugou', type: 'song',
      id: String(rawData.Audioid),
      songmid: String(rawData.Audioid),
      hash: rawData.FileHash || '',
      name: decodeName(rawData.SongName),
      artist: formatSingerName(rawData.Singers, 'name'),
      album: decodeName(rawData.AlbumName),
      albumId: String(rawData.AlbumID || ''),
      cover: '',
      duration: (Number(rawData.Duration) || 0) * 1000,
      qualitys: [rawData.FileHash && '128k', rawData.HQFileHash && '320k', rawData.SQFileHash && 'flac', rawData.ResFileHash && 'flac24bit'].filter(Boolean),
    });
  };
  (result.data.lists || []).forEach((item) => {
    pushRow(item);
    (item.Grp || []).forEach(pushRow);
  });
  return { songs, total: Number(result.data.total) || songs.length };
}

// ---------- tx QQ ----------
const TX_PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const TX_PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const TX_SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];

function txZzcSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const part1 = TX_PART_1_INDEXES.map((idx) => hash[idx]).join('');
  const part2 = TX_PART_2_INDEXES.map((idx) => hash[idx]).join('');
  const part3 = TX_SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64Part = Buffer.from(part3).toString('base64').replace(/[\\/+=]/g, '');
  return ('zzc' + part1 + b64Part + part2).toLowerCase();
}

async function searchTx(keywords, page, limit) {
  const payload = {
    comm: {
      ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic', phonetype: 'EBG-AN10',
      deviceScore: '553.47', devicelevel: '50', newdevicelevel: '20', rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
      os_ver: '12', OpenUDID: '0', OpenUDID2: '0', QIMEI36: '0', udid: '0', chid: '0', aid: '0',
      oaid: '0', taid: '0', tid: '0', wid: '0', uid: '0', sid: '0', modeSwitch: '6', teenMode: '0',
      ui_mode: '2', nettype: '1020', v4ip: '',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0,
        searchid: Math.random().toString().slice(2),
        query: keywords,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: 0,
        sem: 0,
      },
    },
  };
  const sign = txZzcSign(JSON.stringify(payload));
  const body = await httpJson('https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + encodeURIComponent(sign), {
    method: 'post',
    headers: { 'User-Agent': 'QQMusic 14090508(android 12)', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = body && body.req && body.req.data;
  const rawList = (data && data.body && data.body.item_song) || [];
  const songs = rawList.map((item) => {
    if (!item || !item.file || !item.file.media_mid) return null;
    const album = item.album || {};
    const albumMid = album.mid || '';
    return {
      provider: 'qq', source: 'qq', type: 'song',
      id: String(item.id || ''),
      songmid: item.mid || '',
      mid: item.mid || '',
      mediaMid: item.file.media_mid || '',
      albumMid,
      name: decodeName(item.title),
      artist: formatSingerName(item.singer, 'name'),
      album: decodeName(album.name),
      cover: albumMid && albumMid !== '空'
        ? 'https://y.gtimg.cn/music/photo_new/T002R500x500M000' + albumMid + '.jpg'
        : (item.singer && item.singer.length ? 'https://y.gtimg.cn/music/photo_new/T001R500x500M000' + item.singer[0].mid + '.jpg' : ''),
      duration: (Number(item.interval) || 0) * 1000,
    };
  }).filter(Boolean);
  const total = Number(data && data.meta && data.meta.estimate_sum) || songs.length;
  return { songs, total };
}

// ---------- wy 网易云 (eapi) ----------
const WY_EAPI_KEY = 'e82ckenh8dichen8';

function wyEapi(urlPath, object) {
  const text = JSON.stringify(object);
  const message = 'nobody' + urlPath + 'use' + text + 'md5forencrypt';
  const digest = crypto.createHash('md5').update(message).digest('hex');
  const data = urlPath + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest;
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(WY_EAPI_KEY), '');
  return Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]).toString('hex').toUpperCase();
}

async function searchWy(keywords, page, limit) {
  const urlPath = '/api/search/song/list/page';
  const params = wyEapi(urlPath, {
    keyword: keywords,
    needCorrect: '1',
    channel: 'typing',
    offset: limit * (page - 1),
    scene: 'normal',
    total: page === 1,
    limit,
  });
  const result = await httpJson('http://interface.music.163.com/eapi/batch', {
    method: 'post',
    headers: {
      origin: 'https://music.163.com',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'params=' + encodeURIComponent(params),
  });
  if (!result || result.code !== 200 || !result.data) return { songs: [], total: 0 };
  const rawList = result.data.resources || [];
  const songs = rawList.map((item) => {
    item = item && item.baseInfo && item.baseInfo.simpleSongData;
    if (!item || !item.id) return null;
    const al = item.al || {};
    return {
      provider: 'netease', source: 'netease', type: 'song',
      id: String(item.id),
      songmid: String(item.id),
      name: decodeName(item.name),
      artist: Array.isArray(item.ar) ? item.ar.map((a) => decodeName(a.name)).filter(Boolean).join('、') : '',
      album: decodeName(al.name),
      albumId: String(al.id || ''),
      cover: al.picUrl || '',
      duration: Number(item.dt) || 0,
    };
  }).filter(Boolean);
  return { songs, total: Number(result.data.totalCount) || songs.length };
}

// ---------- mg 咪咕 ----------
const MG_DEVICE_ID = '963B7AA0D21511ED807EE5846EC87D20';

async function searchMg(keywords, page, limit) {
  const time = Date.now().toString();
  const sign = md5(keywords + '6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50' + MG_DEVICE_ID + time);
  const url = 'https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1' +
    '&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D' +
    '&pageSize=' + limit + '&text=' + encodeURIComponent(keywords) + '&pageNo=' + page + '&sort=0&sid=USS';
  const result = await httpJson(url, {
    headers: {
      uiVersion: 'A_music_3.6.1',
      deviceId: MG_DEVICE_ID,
      timestamp: time,
      sign,
      channel: '0146921',
      'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    },
  });
  if (!result || result.code !== '000000') return { songs: [], total: 0 };
  const songResultData = result.songResultData || { resultList: [], totalCount: 0 };
  const seen = new Set();
  const songs = [];
  (songResultData.resultList || []).forEach((group) => {
    (Array.isArray(group) ? group : [group]).forEach((data) => {
      if (!data || !data.songId || !data.copyrightId || seen.has(data.copyrightId)) return;
      seen.add(data.copyrightId);
      let img = data.img3 || data.img2 || data.img1 || '';
      if (img && !/https?:/.test(img)) img = 'http://d.musicapp.migu.cn' + img;
      songs.push({
        provider: 'lx', source: 'lx', type: 'song',
        lxSource: 'mg',
        songmid: String(data.songId),
        copyrightId: String(data.copyrightId),
        id: 'lx_mg_' + data.copyrightId,
        name: decodeName(data.name),
        artist: formatSingerName(data.singerList),
        album: decodeName(data.album),
        cover: img,
        duration: (Number(data.duration) || 0) * 1000,
      });
    });
  });
  return { songs, total: Number(songResultData.totalCount) || songs.length };
}

// ---------- 统一入口 ----------
const PLATFORMS = { kw: searchKw, kg: searchKg, tx: searchTx, wy: searchWy, mg: searchMg };

async function handleLxSearch({ source, keywords, offset, limit }) {
  keywords = String(keywords || '').trim();
  if (!keywords) return { provider: 'lx', source: source || 'all', songs: [], total: 0, hasMore: false };
  limit = Math.min(50, Math.max(5, Number(limit) || 30));
  const page = Math.floor(Math.max(0, Number(offset) || 0) / limit) + 1;
  const targets = (source && source !== 'all' && PLATFORMS[source]) ? [source] : Object.keys(PLATFORMS);
  const results = await Promise.allSettled(targets.map((platform) => PLATFORMS[platform](keywords, page, limit)));
  const songs = [];
  let total = 0;
  const errors = [];
  results.forEach((entry, index) => {
    if (entry.status === 'fulfilled') {
      songs.push(...entry.value.songs);
      total += entry.value.total;
    } else {
      errors.push(targets[index] + ': ' + (entry.reason && entry.reason.message || 'failed'));
    }
  });
  const nextOffset = (Math.max(0, Number(offset) || 0)) + songs.length;
  return {
    provider: 'lx',
    source: source || 'all',
    songs,
    total,
    nextOffset,
    hasMore: songs.length > 0 && (errors.length < targets.length),
    limit,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = {
  handleLxSearch,
  util: {
    httpRequest,
    httpJson,
    decodeName,
    formatPlayTime,
    sizeFormate,
    formatSingerName,
    md5,
    lxIntervalToMs,
  },
};
