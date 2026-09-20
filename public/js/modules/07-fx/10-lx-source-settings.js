// ============================================================
// 落雪自定义音源 — 设置面板 (fx-panel "落雪自定义音源" 区块)
// 导入 / 启用 / 删除脚本, 状态展示, "优先使用自定义音源"开关
// ============================================================
function lxSourcePanelNode(id) {
  return document.getElementById(id);
}

function lxSourceStatusText(payload) {
  if (!payload) return '不可用';
  if (!payload.available) return '主进程未接入';
  var scriptStates = payload.scripts || [];
  var okCount = scriptStates.filter(function (s) { return s.status && s.enabled !== false; }).length;
  var total = scriptStates.length;
  if (!total) return '未导入脚本';
  if (!okCount) return '脚本均未连接';
  var sources = payload.sources || {};
  var names = [];
  if (sources.wy) names.push('网易云');
  if (sources.tx) names.push('QQ');
  if (sources.kg) names.push('酷狗');
  if (sources.kw) names.push('酷我');
  if (sources.mg) names.push('咪咕');
  return '已连接 ' + okCount + '/' + total + ' 个脚本 · ' + (names.length ? names.join('/') : '无支持平台');
}

function lxSourceEsc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function renderLxSourceScriptList(payload) {
  var listNode = lxSourcePanelNode('lx-source-script-list');
  if (!listNode) return;
  var scripts = (payload && payload.scripts) || [];
  if (!scripts.length) {
    listNode.innerHTML = '<div class="lx-source-script-empty">还没有导入脚本</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < scripts.length; i++) {
    var s = scripts[i];
    var enabled = s.enabled !== false;
    var connected = !!s.status;
    var stateText = !enabled ? '已停用' : (connected ? '已连接' : '连接失败');
    var srcNames = [];
    var stSources = connected ? (s.sources || {}) : {};
    if (stSources.wy) srcNames.push('网易');
    if (stSources.tx) srcNames.push('QQ');
    if (stSources.kg) srcNames.push('酷狗');
    if (stSources.kw) srcNames.push('酷我');
    if (stSources.mg) srcNames.push('咪咕');
    html += '<div class="lx-source-script-row' + (enabled && connected ? ' active' : '') + '">'
      + '<div class="lx-source-script-info"><span class="lx-source-script-name">' + lxSourceEsc(s.name)
      + '<span class="lx-source-script-state' + (enabled ? (connected ? ' ok' : ' bad') : ' off') + '">' + stateText + '</span></span>'
      + '<span class="lx-source-script-meta">' + lxSourceEsc([
        s.version ? ('v' + s.version) : '',
        srcNames.length ? ('支持: ' + srcNames.join('/')) : (enabled && connected ? '无支持平台' : '')
      ].filter(Boolean).join(' · ')) + '</span></div>'
      + '<div class="lx-source-script-actions">'
      + '<button class="fx-mini-btn' + (enabled ? ' ghost' : '') + '" type="button" onclick="toggleLxSourceScriptEnabled(\'' + lxSourceEsc(s.id) + '\',' + (enabled ? 'false' : 'true') + ')">' + (enabled ? '停用' : '启用') + '</button>'
      + '<button class="fx-mini-btn ghost" type="button" onclick="removeLxSourceScriptById(\'' + lxSourceEsc(s.id) + '\')">删除</button>'
      + '</div></div>';
  }
  listNode.innerHTML = html;
}

function renderLxSourcePanel(listPayload, statusPayload) {
  renderLxSourceScriptList(listPayload);
  var statusNode = lxSourcePanelNode('lx-source-status-text');
  if (statusNode) statusNode.textContent = lxSourceStatusText(statusPayload);
  var preferToggle = lxSourcePanelNode('t-lxSourcePrefer');
  if (preferToggle) preferToggle.classList.toggle('on', lxSourcePreferEnabled());
}

function refreshLxSourcePanel() {
  var statusPromise = apiJson('/api/lxsource/status').catch(function () { return null; });
  var listPromise = apiJson('/api/lxsource/list').catch(function () { return null; });
  return Promise.all([listPromise, statusPromise]).then(function (results) {
    renderLxSourcePanel(results[0], results[1]);
    if (typeof refreshLxSourceStatus === 'function') refreshLxSourceStatus();
    return results;
  });
}

function importLxSourceScript() {
  if (!window.desktopWindow || typeof window.desktopWindow.importJsFile !== 'function') {
    showToast('仅桌面版支持导入音源脚本');
    return;
  }
  window.desktopWindow.importJsFile().then(function (choice) {
    if (!choice || !choice.ok || choice.canceled || !choice.text) return null;
    return apiJson('/api/lxsource/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: choice.text }),
    });
  }).then(function (result) {
    if (!result) return;
    if (result.success) {
      showToast('已导入「' + ((result.script && result.script.name) || '音源脚本') + '」');
    } else {
      showToast('导入失败: ' + (result.error || '未知错误'));
    }
    refreshLxSourcePanel();
  }).catch(function (error) {
    showToast('导入失败: ' + ((error && error.message) || '未知错误'));
    refreshLxSourcePanel();
  });
}

function toggleLxSourceScriptEnabled(id, enabled) {
  apiJson('/api/lxsource/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id, enabled: !!enabled }),
  }).then(function (result) {
    if (!result.success) {
      showToast((enabled ? '启用' : '停用') + '失败: ' + (result.error || '未知错误'));
    }
    // 等脚本窗口完成 init 握手再刷新状态
    setTimeout(refreshLxSourcePanel, 500);
    setTimeout(refreshLxSourcePanel, 2500);
  }).catch(function (error) {
    showToast((enabled ? '启用' : '停用') + '失败: ' + ((error && error.message) || '未知错误'));
    refreshLxSourcePanel();
  });
}

function removeLxSourceScriptById(id) {
  apiJson('/api/lxsource/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id }),
  }).then(function (result) {
    if (!result.success) showToast('删除失败: ' + (result.error || '未知错误'));
    refreshLxSourcePanel();
  }).catch(function () {
    refreshLxSourcePanel();
  });
}

function importLxDataNow() {
  showToast('正在读取落雪数据...');
  apiJson('/api/lxsource/import-lx-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then(function (result) {
    if (!result || !result.success) {
      showToast('导入失败: ' + ((result && result.error) || '未知错误'));
      return;
    }
    var parts = [];
    if (result.scripts && result.scripts.length) parts.push('音源脚本 ' + result.scripts.length + ' 个');
    if (result.scriptErrors && result.scriptErrors.length) parts.push(result.scriptErrors.length + ' 个脚本跳过(' + result.scriptErrors[0] + ')');
    var saveInfo = null;
    if (typeof importLxDataLists === 'function' && result.lists && result.lists.length) {
      saveInfo = importLxDataLists(result.lists);
      parts.push('歌单 ' + result.lists.length + ' 个 / ' + saveInfo.addedSongs + ' 首歌');
    }
    showToast('导入完成: ' + (parts.join(' · ') || '没有新内容'));
    // 所有脚本自动并行加载, 无需单独启用
    setTimeout(refreshLxSourcePanel, 800);
    setTimeout(refreshLxSourcePanel, 2600);
  }).catch(function (error) {
    showToast('导入失败: ' + ((error && error.message) || '未知错误'));
  });
}

function toggleLxSourcePrefer() {
  var next = !lxSourcePreferEnabled();
  try {
    localStorage.setItem(LX_SOURCE_PREFER_STORE_KEY, next ? '1' : '0');
  } catch (_) {}
  var preferToggle = lxSourcePanelNode('t-lxSourcePrefer');
  if (preferToggle) preferToggle.classList.toggle('on', next);
  showToast(next ? '全部歌曲优先用落雪音源' : '已恢复官方接口优先');
}

// ---------- 启动时自动静默导入落雪数据 (仅首次) ----------
var LX_DATA_AUTOIMPORT_FLAG = 'mineradio-lx-data-imported-v1';

function autoImportLxDataSilently() {
  try {
    if (localStorage.getItem(LX_DATA_AUTOIMPORT_FLAG) === '1') return;
  } catch (_) { return; }
  apiJson('/api/lxsource/import-lx-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then(function (result) {
    if (!result || !result.success) return;
    try { localStorage.setItem(LX_DATA_AUTOIMPORT_FLAG, '1'); } catch (_) { }
    var saveInfo = (typeof importLxDataLists === 'function' && result.lists && result.lists.length)
      ? importLxDataLists(result.lists)
      : null;
    if (result.scripts && result.scripts.length) {
      showToast('已从落雪导入 ' + result.scripts.length + ' 个音源脚本' + (saveInfo ? ('、歌单 ' + saveInfo.addedSongs + ' 首') : ''));
    } else if (saveInfo && saveInfo.addedSongs) {
      showToast('已从落雪导入歌单 ' + saveInfo.addedSongs + ' 首歌');
    }
    refreshLxSourcePanel();
  }).catch(function () { });
}

setTimeout(refreshLxSourcePanel, 450);
setTimeout(autoImportLxDataSilently, 1600);
