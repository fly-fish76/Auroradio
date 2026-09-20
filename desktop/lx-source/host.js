'use strict';

// lx 自定义音源宿主 (主进程, 多脚本并行版)
// 移植自 lx-music-desktop src/main/modules/userApi (GPL-3.0), 扩展:
// - 每个脚本一个隐藏沙箱窗口, 全部常驻, 按 event.sender / requestKey 前缀路由
// - requestLxMusicUrl 并行询问所有启用的脚本, 同音质下取最先成功者 (跨脚本取最优音质
//   由渲染侧质量链自上而下逐档竞速实现)
const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const USER_API_RENDERER_EVENT_NAME = require('./event-names');

// ---------- 存储 ----------
let dataDir = '';
let store = { version: 1, activeId: '', apis: [] };
let inited = false;
const instances = new Map(); // id -> {api, browserWindow, status, message, sources, pending:Map, timeouts:Map, lastUpdateAlert}

const storePath = () => path.join(dataDir, 'lx-user-api.json');

const saveStore = () => {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[LxSource] save store failed:', err && err.message);
  }
};

const loadStore = () => {
  try {
    if (fs.existsSync(storePath())) {
      const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
      if (parsed && Array.isArray(parsed.apis)) {
        store = { version: 1, activeId: parsed.activeId || '', apis: parsed.apis };
      }
    }
  } catch (err) {
    console.error('[LxSource] load store failed:', err && err.message);
    store = { version: 1, activeId: '', apis: [] };
  }
};

// ---------- 脚本信息解析 (移植 lx utils.ts parseScriptInfo) ----------
const INFO_NAMES = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 };

const matchInfo = (scriptInfo) => {
  const infoArr = scriptInfo.split(/\r?\n/);
  const rxp = /^\s?\*\s?@(\w+)\s(.+)$/;
  const infos = {};
  for (const info of infoArr) {
    const result = rxp.exec(info);
    if (!result) continue;
    const key = result[1];
    if (INFO_NAMES[key] == null) continue;
    infos[key] = result[2].trim();
  }
  for (const key of Object.keys(INFO_NAMES)) {
    if (infos[key] == null) infos[key] = '';
    else if (infos[key].length > INFO_NAMES[key]) infos[key] = infos[key].substring(0, INFO_NAMES[key]) + '...';
  }
  return infos;
};

const parseScriptInfo = (script) => {
  const result = /^\/\*[\S|\s]+?\*\//.exec(script);
  if (!result) throw new Error('无效的自定义源文件');
  const scriptInfo = matchInfo(result[0]);
  if (!scriptInfo.name) scriptInfo.name = `user_api_${new Date().toLocaleString()}`;
  return scriptInfo;
};

// ---------- 实例 (每脚本一个隐藏窗口) ----------
const WINDOW_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>lx user api</title></head><body></body></html>';

const denyEvents = [
  'will-navigate',
  'will-redirect',
  'will-attach-webview',
  'will-prevent-unload',
  'media-started-playing',
];

const getProxy = () => {
  const envProxy = process.env.MINERADIO_PROXY;
  if (envProxy && typeof envProxy == 'string') {
    const [host, port = ''] = envProxy.split(':');
    if (host) return { host, port };
  }
  return { host: '', port: '' };
};

const findInstanceBySender = (webContents) => {
  for (const instance of instances.values()) {
    if (instance.browserWindow && !instance.browserWindow.isDestroyed() && instance.browserWindow.webContents === webContents) {
      return instance;
    }
  }
  return null;
};

const closeInstance = async(instance) => {
  if (!instance) return;
  for (const [key, entry] of instance.pending) {
    entry.reject(new Error('source closed'));
    instance.pending.delete(key);
    const t = instance.timeouts.get(key);
    if (t) clearTimeout(t);
    instance.timeouts.delete(key);
  }
  instance.pending.clear();
  instance.timeouts.clear();
  if (instance.browserWindow) {
    try {
      await Promise.all([
        instance.browserWindow.webContents.session.clearAuthCache(),
        instance.browserWindow.webContents.session.clearStorageData(),
        instance.browserWindow.webContents.session.clearCache(),
      ]);
    } catch (_) { }
    try { instance.browserWindow.destroy(); } catch (_) { }
    instance.browserWindow = null;
  }
  instance.status = false;
  instance.sources = {};
};

async function startInstance(apiFull) {
  const instance = {
    api: apiFull,
    browserWindow: null,
    status: false,
    message: '',
    sources: {},
    pending: new Map(),
    timeouts: new Map(),
    lastUpdateAlert: null,
  };
  instances.set(apiFull.id, instance);

  const win = new BrowserWindow({
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      spellcheck: false,
      autoplayPolicy: 'document-user-activation-required',
      enableWebSQL: false,
      disableDialogs: true,
      webgl: false,
      images: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  instance.browserWindow = win;

  for (const eventName of denyEvents) {
    win.webContents.on(eventName, (event) => {
      event.preventDefault();
    });
  }
  win.webContents.session.setPermissionRequestHandler((webContents, permission, resolve) => {
    const mine = instance.browserWindow && !instance.browserWindow.isDestroyed() && instance.browserWindow.webContents === webContents;
    resolve(!mine);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    instance.browserWindow = null;
    instance.status = false;
  });

  await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(WINDOW_HTML));

  win.webContents.on('ready-to-show', () => {
    if (!instance.browserWindow || instance.browserWindow.isDestroyed()) return;
    instance.browserWindow.webContents.send(USER_API_RENDERER_EVENT_NAME.initEnv, {
      id: apiFull.id,
      name: apiFull.name,
      description: apiFull.description,
      author: apiFull.author,
      homepage: apiFull.homepage,
      version: apiFull.version,
      allowShowUpdateAlert: apiFull.allowShowUpdateAlert !== false,
      script: apiFull.script,
      proxy: getProxy(),
    });
  });
  return instance;
}

const getInstance = (id) => instances.get(id) || null;

async function stopInstance(id) {
  const instance = instances.get(id);
  if (!instance) return;
  await closeInstance(instance);
  instances.delete(id);
}

// ---------- IPC ----------
const clearRequestTimeout = (instance, requestKey) => {
  const timeout = instance.timeouts.get(requestKey);
  if (timeout) {
    clearTimeout(timeout);
    instance.timeouts.delete(requestKey);
  }
};

const registerIpcHandlers = () => {
  ipcMain.on(USER_API_RENDERER_EVENT_NAME.init, (event, params) => {
    const instance = findInstanceBySender(event.sender);
    if (!instance) return;
    const { status, message, data } = params || {};
    if (!status) {
      instance.status = false;
      instance.message = message || 'init failed';
      console.warn('[LxSource] init failed:', instance.api.name, message);
      return;
    }
    instance.status = true;
    instance.message = '';
    instance.sources = (data && data.sources) || {};
    console.log('[LxSource] init ok:', instance.api.name);
  });

  ipcMain.on(USER_API_RENDERER_EVENT_NAME.response, (event, params) => {
    const { status, message, data } = params || {};
    const requestKey = (data && data.requestKey) || '';
    // requestKey 前缀 = 实例 id, 据此路由
    const sep = requestKey.indexOf('__');
    const instanceId = sep > 0 ? requestKey.slice(0, sep) : '';
    const instance = instances.get(instanceId) || findInstanceBySender(event.sender);
    if (!instance) return;
    const request = instance.pending.get(requestKey);
    if (!request) return;
    instance.pending.delete(requestKey);
    clearRequestTimeout(instance, requestKey);
    if (status) {
      request.resolve(data.result);
    } else {
      request.reject(new Error(message || 'request failed'));
    }
  });

  ipcMain.on(USER_API_RENDERER_EVENT_NAME.openDevTools, (event) => {
    const instance = findInstanceBySender(event.sender);
    if (instance && instance.browserWindow) {
      try { instance.browserWindow.webContents.openDevTools({ mode: 'detach' }); } catch (_) { }
    }
  });

  ipcMain.on(USER_API_RENDERER_EVENT_NAME.showUpdateAlert, (event, params) => {
    const instance = findInstanceBySender(event.sender);
    const data = (params && params.data) || {};
    if (!instance || instance.api.allowShowUpdateAlert === false) return;
    instance.lastUpdateAlert = {
      name: instance.api.name,
      description: instance.api.description,
      log: data.log,
      updateUrl: data.updateUrl,
    };
  });

  ipcMain.on(USER_API_RENDERER_EVENT_NAME.getProxy, (event) => {
    const instance = findInstanceBySender(event.sender);
    if (instance && instance.browserWindow && !instance.browserWindow.isDestroyed()) {
      instance.browserWindow.webContents.send(USER_API_RENDERER_EVENT_NAME.proxyUpdate, getProxy());
    }
  });
};

// ---------- 对外 API ----------
const scriptPublicInfo = (api) => ({
  id: api.id,
  name: api.name,
  description: api.description,
  author: api.author,
  homepage: api.homepage,
  version: api.version,
  enabled: api.enabled !== false,
});

const isScriptEnabled = (api) => api && api.enabled !== false;

const getLxScriptList = () => {
  return {
    activeId: store.activeId || '',
    scripts: store.apis.map((api) => {
      const instance = instances.get(api.id);
      return Object.assign(scriptPublicInfo(api), {
        status: !!(instance && instance.status),
        sources: (instance && instance.status && instance.sources) || {},
        message: instance ? instance.message : '',
      });
    }),
  };
};

const importLxScript = (scriptRaw) => {
  const scriptInfo = parseScriptInfo(scriptRaw);
  for (const api of store.apis) {
    if (api.script === scriptRaw) {
      throw new Error(`导入失败，脚本内容与已有的源「${api.name}」相同`);
    }
  }
  const apiInfo = {
    id: `user_api_${Math.random().toString().substring(2, 5)}_${Date.now()}`,
    ...scriptInfo,
    allowShowUpdateAlert: true,
    enabled: true,
    script: scriptRaw,
  };
  store.apis.push(apiInfo);
  saveStore();
  startInstance(apiInfo).catch((err) => {
    console.error('[LxSource] start instance failed:', apiInfo.name, err && err.message);
  });
  return scriptPublicInfo(apiInfo);
};

const removeLxScript = (id) => {
  const idx = store.apis.findIndex((api) => api.id == id);
  if (idx < 0) return;
  store.apis.splice(idx, 1);
  if (store.activeId == id) store.activeId = '';
  void stopInstance(id);
  saveStore();
};

// 兼容旧接口: 传入 id = 仅启用该脚本, 传 '' = 全部启用
const setActiveLxScript = async(id) => {
  store.activeId = id || '';
  for (const api of store.apis) {
    api.enabled = !id || api.id == id;
  }
  saveStore();
  // 同步实例启停
  for (const api of store.apis) {
    if (api.enabled && !instances.has(api.id)) {
      startInstance(api).catch(() => { });
    } else if (!api.enabled && instances.has(api.id)) {
      await stopInstance(api.id);
    }
  }
};

const setLxScriptEnabled = async(id, enabled) => {
  const api = store.apis.find((a) => a.id == id);
  if (!api) throw new Error('api not found');
  api.enabled = !!enabled;
  saveStore();
  if (api.enabled && !instances.has(api.id)) {
    await startInstance(api);
  } else if (!api.enabled && instances.has(api.id)) {
    await stopInstance(api.id);
  }
};

const getLxSourceStatus = () => {
  let anyActive = false;
  const sourcesUnion = {};
  const scriptStates = [];
  for (const api of store.apis) {
    if (api.enabled === false) continue;
    const instance = instances.get(api.id);
    const ok = !!(instance && instance.status);
    if (ok) {
      anyActive = true;
      for (const [src, info] of Object.entries(instance.sources || {})) {
        if (!sourcesUnion[src]) sourcesUnion[src] = { type: info.type || 'music', actions: [], qualitys: [] };
        for (const a of (info.actions || [])) if (!sourcesUnion[src].actions.includes(a)) sourcesUnion[src].actions.push(a);
        for (const q of (info.qualitys || [])) if (!sourcesUnion[src].qualitys.includes(q)) sourcesUnion[src].qualitys.push(q);
      }
    }
    scriptStates.push({
      id: api.id,
      name: api.name,
      status: ok,
      enabled: api.enabled !== false,
      message: instance ? instance.message : '',
    });
  }
  const alerts = [];
  for (const instance of instances.values()) {
    if (instance.lastUpdateAlert) alerts.push(instance.lastUpdateAlert);
  }
  return {
    active: anyActive,
    status: anyActive,
    message: anyActive ? '' : (store.apis.length ? '所有音源脚本均未初始化成功' : '未导入脚本'),
    sources: sourcesUnion,
    scripts: scriptStates,
    lastUpdateAlert: alerts[alerts.length - 1] || null,
  };
};

// 向单个脚本发起一次 musicUrl 请求 (20s 超时)
const sendInstanceRequest = (instance, source, quality, musicInfo) => new Promise((resolveReq, rejectReq) => {
  const requestKey = instance.api.id + '__request__' + Math.random().toString().substring(2);
  instance.timeouts.set(requestKey, setTimeout(() => {
    const entry = instance.pending.get(requestKey);
    if (entry) {
      instance.pending.delete(requestKey);
      clearRequestTimeout(instance, requestKey);
      entry.reject(new Error('Cancel request'));
    }
  }, 20000));
  instance.pending.set(requestKey, { resolve: resolveReq, reject: rejectReq });
  if (instance.browserWindow && !instance.browserWindow.isDestroyed()) {
    instance.browserWindow.webContents.send(USER_API_RENDERER_EVENT_NAME.request, {
      requestKey,
      data: { source, action: 'musicUrl', info: { type: quality, musicInfo } },
    });
  } else {
    rejectReq(new Error('window gone'));
  }
});

// 并行询问所有启用且支持的脚本, 同音质下最先成功者胜出
const requestLxMusicUrl = ({ source, quality, musicInfo, preferredId }) => new Promise((resolve, reject) => {
  const candidates = [];
  for (const api of store.apis) {
    if (isScriptEnabled(api) === false) continue;
    if (preferredId && api.id !== preferredId) continue;
    const instance = instances.get(api.id);
    if (!instance || !instance.status) continue;
    const srcInfo = instance.sources[source];
    if (!srcInfo || !srcInfo.actions || !srcInfo.actions.includes('musicUrl')) continue;
    if (!srcInfo.qualitys || !srcInfo.qualitys.includes(quality)) continue;
    candidates.push(instance);
  }
  if (!candidates.length) {
    reject(new Error('no source supports ' + source + '@' + quality));
    return;
  }
  let pending = candidates.length;
  let settled = false;
  const tryNext = () => {
    pending -= 1;
    if (pending <= 0 && !settled) {
      settled = true;
      reject(new Error('all sources failed'));
    }
  };
  for (const instance of candidates) {
    sendInstanceRequest(instance, source, quality, musicInfo).then((result) => {
      if (settled) return;
      settled = true;
      resolve({ result, via: instance.api.name, viaId: instance.api.id });
    }).catch(tryNext);
  }
});

// 链接验活: 经本地 /api/audio 代理做一次 Range 探测 (与真实播放路径完全一致, 复用防盗链头/鉴权)。
// 4xx/5xx、被中断、错误页 (总长 < 100KB) 都视为死链。
const localAudioPort = Number(process.env.PORT) || 3000;
const validateAudioUrl = (url) => {
  if (!url) return Promise.resolve(false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  return fetch('http://127.0.0.1:' + localAudioPort + '/api/audio?url=' + encodeURIComponent(url), {
    headers: { Range: 'bytes=0-1023' },
    signal: ctrl.signal,
  }).then((resp) => {
    clearTimeout(timer);
    try { if (resp.body && resp.body.resume) resp.body.resume(); } catch (_) {}
    if (!resp.ok && resp.status !== 206) return false;
    const cr = resp.headers.get('content-range') || '';
    const total = Number(String(cr).split('/')[1]) || Number(resp.headers.get('content-length')) || 0;
    if (total && total < 100 * 1024) return false;
    return true;
  }).catch(() => { clearTimeout(timer); return false; });
};

// 多音质 × 多脚本 全并行竞速: 一轮内取"可用的最高音质"。
// rank 按传入 qualityList 顺序 (0 最优)。更优音质全部失败后自动落级;
// 只要没有更优档位还在等待, 成功即立刻返回, 不等慢脚本。
// 胜出链接先经验活 (Range 探测), 死链视为该脚本该档位失败, 自动落到其余候选。
const requestLxMusicUrlBest = ({ source, qualityList, musicInfo, preferredId }) => new Promise((resolve, reject) => {
  const qualities = (qualityList || []).filter(Boolean);
  if (!qualities.length) {
    reject(new Error('no quality requested'));
    return;
  }
  const candidates = [];
  qualities.forEach((quality, rank) => {
    for (const api of store.apis) {
      if (api.enabled === false) continue;
      if (preferredId && api.id !== preferredId) continue;
      const instance = instances.get(api.id);
      if (!instance || !instance.status) continue;
      const srcInfo = instance.sources[source];
      if (!srcInfo || !srcInfo.actions || !srcInfo.actions.includes('musicUrl')) continue;
      if (!srcInfo.qualitys || !srcInfo.qualitys.includes(quality)) continue;
      candidates.push({ instance, quality, rank, done: false });
    }
  });
  if (!candidates.length) {
    reject(new Error('no source supports ' + source));
    return;
  }
  let settled = false;
  let pending = candidates.length;
  const bestByRank = {};

  const tryResolve = () => {
    const storedRanks = Object.keys(bestByRank).map(Number).sort((a, b) => a - b);
    if (!storedRanks.length) return false;
    const bestStored = storedRanks[0];
    const betterPending = candidates.some((c) => !c.done && c.rank < bestStored);
    if (betterPending) return false;
    settled = true;
    resolve(bestByRank[bestStored]);
    return true;
  };

  for (const entry of candidates) {
    sendInstanceRequest(entry.instance, source, entry.quality, musicInfo).then(async (result) => {
      if (settled) return;
      const url = result && result.data && result.data.url;
      if (!(await validateAudioUrl(url))) {
        // 死链: 该脚本该档位按失败处理, 落到其余候选脚本/音质
        entry.done = true;
        pending -= 1;
        if (pending <= 0) {
          if (!tryResolve()) {
            settled = true;
            reject(new Error('all sources failed'));
          }
          return;
        }
        tryResolve();
        return;
      }
      entry.done = true;
      pending -= 1;
      if (!bestByRank[entry.rank]) bestByRank[entry.rank] = { result, quality: entry.quality, via: entry.instance.api.name, viaId: entry.instance.api.id };
      tryResolve();
      if (!settled && pending <= 0) {
        settled = true;
        reject(new Error('all sources failed'));
      }
    }).catch(() => {
      if (settled) return;
      entry.done = true;
      pending -= 1;
      if (pending <= 0) {
        if (!tryResolve()) {
          settled = true;
          reject(new Error('all sources failed'));
        }
        return;
      }
      tryResolve();
    });
  }
});

// ---------- 初始化 ----------
const initLxSourceHost = (options) => {
  if (inited) return;
  inited = true;
  dataDir = (options && options.dataDir) || path.join(app.getPath('appData'), 'Auroradio');
  loadStore();
  registerIpcHandlers();
  app.on('will-quit', () => {
    for (const instance of instances.values()) void closeInstance(instance);
  });
  // 加载所有启用的脚本 (多源并行竞速)
  for (const api of store.apis) {
    if (api.enabled === false) continue;
    startInstance(api).catch((err) => {
      console.error('[LxSource] create window failed:', api.name, err && err.message);
    });
  }
};

module.exports = {
  initLxSourceHost,
  getLxScriptList,
  importLxScript,
  removeLxScript,
  setActiveLxScript,
  setLxScriptEnabled,
  getLxSourceStatus,
  requestLxMusicUrl,
  requestLxMusicUrlBest,
};
