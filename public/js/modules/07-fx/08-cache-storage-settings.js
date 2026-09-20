function mineradioCacheStorageNode(id) {
  return document.getElementById(id);
}

function formatAuroradioCacheBytes(value) {
  var bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + ' B';
  var units = ['KB', 'MB', 'GB', 'TB'];
  var index = -1;
  do {
    bytes /= 1024;
    index += 1;
  } while (bytes >= 1024 && index < units.length - 1);
  return (bytes >= 100 || index === 0 ? bytes.toFixed(0) : bytes.toFixed(1)) + ' ' + units[index];
}

function setAuroradioCacheStorageText(id, value) {
  var node = mineradioCacheStorageNode(id);
  if (node) node.textContent = value == null || value === '' ? '—' : String(value);
}

function applyAuroradioCacheSettings(snapshot) {
  if (!snapshot || !snapshot.ok) {
    setAuroradioCacheStorageText('cache-storage-total', '读取失败');
    setAuroradioCacheStorageText('cache-storage-note', snapshot && snapshot.error ? ('缓存设置不可用：' + snapshot.error) : '缓存设置不可用');
    return;
  }
  var settings = snapshot.settings || {};
  var usage = snapshot.usage || {};
  setAuroradioCacheStorageText('cache-storage-root', settings.rootPath);
  setAuroradioCacheStorageText('cache-storage-total', '已占用 ' + formatAuroradioCacheBytes(usage.totalManagedBytes));
  setAuroradioCacheStorageText('cache-storage-lyrics-path', settings.lyricsPath);
  setAuroradioCacheStorageText('cache-storage-lyrics-size', formatAuroradioCacheBytes(usage.lyricsBytes));
  setAuroradioCacheStorageText('cache-storage-chromium-path', settings.activeChromiumPath || settings.chromiumPath);
  setAuroradioCacheStorageText('cache-storage-chromium-size', formatAuroradioCacheBytes(usage.chromiumBytes));
  setAuroradioCacheStorageText('cache-storage-beatmaps-path', settings.activeBeatmapsPath || settings.beatmapsPath);
  setAuroradioCacheStorageText('cache-storage-beatmaps-size', formatAuroradioCacheBytes(usage.beatmapsBytes));
  setAuroradioCacheStorageText('cache-storage-wallpaper-path', settings.activeWallpaperEnginePath || settings.wallpaperEnginePath);
  setAuroradioCacheStorageText('cache-storage-wallpaper-size', formatAuroradioCacheBytes(usage.wallpaperEngineBytes));
  setAuroradioCacheStorageText('cache-storage-userdata-path', settings.userDataPath || '系统安全数据目录');
  setAuroradioCacheStorageText('cache-storage-userdata-size', formatAuroradioCacheBytes(usage.userDataBytes));
  var restartButton = mineradioCacheStorageNode('cache-storage-restart');
  if (restartButton) restartButton.hidden = !settings.restartRequired;
  setAuroradioCacheStorageText(
    'cache-storage-note',
    settings.restartRequired
      ? '歌词缓存已切换；封面、网络、音频分片、节奏分析与 WE 静音场景将在重启后改用新目录。'
      : '歌词缓存立即生效；封面、网络、音频分片、节奏分析与 WE 静音场景已使用此目录。'
  );
}

function refreshAuroradioCacheSettings() {
  if (!window.desktopWindow || typeof window.desktopWindow.getCacheSettings !== 'function') {
    applyAuroradioCacheSettings({ ok: false, error: '仅桌面版支持本地缓存路径设置' });
    return Promise.resolve();
  }
  setAuroradioCacheStorageText('cache-storage-total', '正在统计...');
  return window.desktopWindow.getCacheSettings().then(applyAuroradioCacheSettings).catch(function (error) {
    applyAuroradioCacheSettings({ ok: false, error: error && error.message || '读取失败' });
  });
}

function chooseAuroradioCacheRoot() {
  if (!window.desktopWindow || typeof window.desktopWindow.chooseCacheDirectory !== 'function') return;
  window.desktopWindow.chooseCacheDirectory().then(function (choice) {
    if (!choice || !choice.ok || choice.canceled || !choice.rootPath) return;
    return window.desktopWindow.setCacheSettings({ rootPath: choice.rootPath });
  }).then(function (snapshot) {
    if (snapshot) applyAuroradioCacheSettings(snapshot);
  }).catch(function (error) {
    applyAuroradioCacheSettings({ ok: false, error: error && error.message || '保存失败' });
  });
}

function restartAuroradioForCachePath() {
  if (!window.desktopWindow || typeof window.desktopWindow.restartApp !== 'function') return;
  window.desktopWindow.restartApp();
}

setTimeout(refreshAuroradioCacheSettings, 450);
