var progressDragState = {
  active: false,
  lastParticleAt: 0,
  previewTime: 0,
  previewDuration: 0,
  resumeAfterSeek: false,
  media: null,
  mediaSrc: '',
  commitSerial: 0,
  previewHoldUntil: 0,
  previewHoldSerial: 0,
  previewClockBase: 0,
  previewClockStartedAt: 0,
  previewClockRunning: false,
  previewClockShouldRun: false,
  previewAudioSettled: false,
  previewReleaseAt: 0,
  previewReleaseDelay: 96,
  previewSettleTarget: 0,
  previewSettleStartedAt: 0,
  previewSettleMedia: null,
  previewSettleMediaSrc: '',
  resumePlaySerial: 0,
  barRect: null,
  pendingPointer: null,
  pointerPreviewRaf: 0
};
var progressLyricPreviewRaf = 0;
function progressSeekPreviewVisualReady() {
  if (!lyricsLines || !lyricsLines.length || (fx && fx.particleLyrics === false)) return true;
  if (typeof stageLyricProgressSeekVisualReady !== 'function') return true;
  return stageLyricProgressSeekVisualReady(getProgressPreviewClockSeconds());
}
function clearProgressPreviewHold(serial) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return false;
  progressDragState.previewHoldUntil = 0;
  progressDragState.previewHoldSerial = 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = false;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewSettleTarget = 0;
  progressDragState.previewSettleStartedAt = 0;
  progressDragState.previewSettleMedia = null;
  progressDragState.previewSettleMediaSrc = '';
  return true;
}
function isProgressDragPreviewActive() {
  if (!progressDragState || progressDragState.previewDuration <= 0) return false;
  if (progressDragState.active) return true;
  var now = performance.now();
  if (progressDragState.previewHoldSerial) {
    if (progressDragState.previewAudioSettled && progressSeekPreviewVisualReady()) {
      if (!progressDragState.previewReleaseAt) {
        progressDragState.previewReleaseAt = now + Math.max(34, Number(progressDragState.previewReleaseDelay) || 96);
      }
      if (now < progressDragState.previewReleaseAt) return true;
      clearProgressPreviewHold(progressDragState.previewHoldSerial);
      return false;
    }
    progressDragState.previewReleaseAt = 0;
    if (progressDragState.previewHoldUntil > now) return true;
    var settleAge = now - (Number(progressDragState.previewSettleStartedAt) || now);
    var settleMedia = progressDragState.previewSettleMedia;
    if (settleAge < 5200 && settleMedia && progressSeekMediaStillCurrent(settleMedia, progressDragState.previewSettleMediaSrc)) {
      progressDragState.previewHoldUntil = now + 420;
      return true;
    }
    clearProgressPreviewHold(progressDragState.previewHoldSerial);
    return false;
  }
  progressDragState.previewClockRunning = false;
  return false;
}
function getProgressPreviewClockSeconds() {
  var t = Number(progressDragState.previewTime) || 0;
  if (!progressDragState.active && progressDragState.previewClockRunning && progressDragState.previewHoldUntil > performance.now()) {
    var elapsed = Math.max(0, (performance.now() - (Number(progressDragState.previewClockStartedAt) || performance.now())) / 1000);
    t = (Number(progressDragState.previewClockBase) || 0) + elapsed;
    if (progressDragState.previewDuration > 0) t = Math.min(t, progressDragState.previewDuration);
    progressDragState.previewTime = t;
  }
  return t;
}
function getProgressDragPreviewSeconds() {
  return isProgressDragPreviewActive() ? getProgressPreviewClockSeconds() : null;
}
function beginProgressPreviewHold(serial, holdMs, runClock, media, mediaSrc, targetTime) {
  progressDragState.previewHoldSerial = serial || progressDragState.previewHoldSerial || 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = !!runClock;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewReleaseDelay = 96;
  progressDragState.previewSettleTarget = Math.max(0, Number(targetTime) || Number(progressDragState.previewTime) || 0);
  progressDragState.previewSettleStartedAt = performance.now();
  progressDragState.previewSettleMedia = media || null;
  progressDragState.previewSettleMediaSrc = mediaSrc || '';
  progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
  progressDragState.previewClockStartedAt = performance.now();
  progressDragState.previewHoldUntil = performance.now() + Math.max(1200, Number(holdMs) || 2800);
  scheduleProgressLyricPreviewTick();
}
function finishProgressPreviewHold(serial, settleMs) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return;
  var settleMedia = progressDragState.previewSettleMedia;
  var mediaSeconds = settleMedia && isFinite(Number(settleMedia.currentTime)) ? Math.max(0, Number(settleMedia.currentTime)) : null;
  if (mediaSeconds != null) progressDragState.previewTime = mediaSeconds;
  progressDragState.previewAudioSettled = true;
  progressDragState.previewReleaseDelay = Math.max(34, Number(settleMs) || 96);
  if (progressDragState.previewClockShouldRun) {
    progressDragState.previewClockRunning = true;
    progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
    progressDragState.previewClockStartedAt = performance.now();
  }
  scheduleProgressLyricPreviewTick();
}
function scheduleProgressLyricPreviewTick() {
  if (typeof markRenderInteraction === 'function') markRenderInteraction('progress-drag', 420);
  if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
  if (progressLyricPreviewRaf) return;
  var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
  progressLyricPreviewRaf = raf(function () {
    progressLyricPreviewRaf = 0;
    if (!isProgressDragPreviewActive()) return;
    // The main rAF loop is the sole lyric tick owner.  Calling it here as well
    // made a seek preview update the same track twice in one display frame.
    if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
    if (isProgressDragPreviewActive()) scheduleProgressLyricPreviewTick();
  });
}
function normalizePlaybackDurationSeconds(value) {
  var raw = Number(value);
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 1000 ? raw / 1000 : raw;
}
function playbackDurationFromSong(song) {
  if (!song) return 0;
  return normalizePlaybackDurationSeconds(song.duration || song.durationMs || song.dt || 0);
}
function getPlaybackDurationSeconds() {
  if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return playbackDurationFromSong(currentCoverSong());
}
function getPlaybackCurrentSeconds() {
  return audio && isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0;
}
function setProgressVisual(percent) {
  percent = clampRange(percent || 0, 0, 100);
  var fill = document.getElementById('progress-fill');
  var thumb = document.getElementById('progress-thumb');
  if (fill) fill.style.width = percent + '%';
  if (thumb) thumb.style.left = percent + '%';
  var bar = document.getElementById('progress-bar');
  if (bar) bar.style.setProperty('--progress-percent', percent.toFixed(3) + '%');
}
function updatePlaybackProgressUi() {
  if (isProgressDragPreviewActive() && progressDragState.previewDuration > 0) {
    renderProgressPreview(getProgressPreviewClockSeconds(), progressDragState.previewDuration);
    return;
  }
  var durationSec = getPlaybackDurationSeconds();
  var currentSec = getPlaybackCurrentSeconds();
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
}

function playbackTransitionHasAudibleNextDeck() {
  var cuefieldMedia = typeof cuefieldAutoMixPreparedAudio !== 'undefined' ? cuefieldAutoMixPreparedAudio : null;
  if (
    typeof cuefieldAutoMixExecuting !== 'undefined'
    && cuefieldAutoMixExecuting
    && cuefieldMedia
    && cuefieldMedia !== audio
    && !cuefieldMedia.paused
    && !cuefieldMedia.ended
    && Number(cuefieldMedia.volume) > 0.001
  ) return true;
  var preload = typeof albumGaplessState !== 'undefined' && albumGaplessState ? albumGaplessState.preload : null;
  return !!(
    preload
    && preload.mixStarted
    && preload.media
    && preload.media !== audio
    && !preload.media.paused
    && !preload.media.ended
    && Number(preload.media.volume) > 0.001
  );
}

function bindPlaybackProgressEvents(audioEl) {
  if (!audioEl || audioEl._mineradioProgressBound) return;
  audioEl._mineradioProgressBound = true;
  ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'emptied'].forEach(function (name) {
    audioEl.addEventListener(name, updatePlaybackProgressUi);
  });
  audioEl.addEventListener('timeupdate', function () {
    if (typeof tickCuefieldAutoMix === 'function') tickCuefieldAutoMix();
  });
  ['play', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      if (Number(audioEl.__mineradioTrackSwitchToken) !== Number(trackSwitchToken)) return;
      if (
        name !== 'emptied'
        && typeof playbackMediaMatchesCurrentQueueItem === 'function'
        && !playbackMediaMatchesCurrentQueueItem(audioEl)
      ) return;
      if (name === 'ended' && audioEl === audio && playbackTransitionHasAudibleNextDeck()) return;
      syncPlaybackStateFromAudioEvent(name);
      saveLastPlaybackSnapshot(name === 'pause' || name === 'ended', name);
    });
  });
  ['error', 'stalled'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      if (Number(audioEl.__mineradioTrackSwitchToken) !== Number(trackSwitchToken)) return;
      if (typeof playbackMediaMatchesCurrentQueueItem === 'function' && !playbackMediaMatchesCurrentQueueItem(audioEl)) return;
      if (typeof schedulePlaybackStallRecovery === 'function') {
        schedulePlaybackStallRecovery(name, {
          silent: name !== 'error',
          ownerMedia: audioEl,
          ownerToken: trackSwitchToken,
          ownerQueueItemKey: String(audioEl.__mineradioQueueItemKey || '')
        });
      }
    });
  });
}
function emitProgressDragParticles(x, y) {
  var now = performance.now();
  if (now - progressDragState.lastParticleAt < 46) return;
  progressDragState.lastParticleAt = now;
  for (var i = 0; i < 3; i++) {
    var dot = document.createElement('span');
    dot.className = 'progress-drag-particle';
    var dx = (Math.random() - 0.5) * 34;
    var dy = -10 - Math.random() * 28;
    dot.style.setProperty('--px', x + 'px');
    dot.style.setProperty('--py', y + 'px');
    dot.style.setProperty('--dx', dx + 'px');
    dot.style.setProperty('--dy', dy + 'px');
    document.body.appendChild(dot);
    setTimeout((function (el) { return function () { if (el && el.parentNode) el.parentNode.removeChild(el); }; })(dot), 700);
  }
}
var laserParticleLastAt = 0;
function maybeEmitLaserParticles() {
  if (!fx || fx.progressStyle !== 'laser' || !audio || audio.paused || progressDragState.active) return;
  var now = performance.now();
  if (now - laserParticleLastAt < 190) return;
  laserParticleLastAt = now;
  var bar = document.getElementById('progress-bar');
  if (!bar) return;
  var rect = bar.getBoundingClientRect();
  var percent = parseFloat(bar.style.getPropertyValue('--progress-percent')) || 0;
  var dot = document.createElement('span');
  dot.className = 'progress-laser-particle';
  dot.style.setProperty('--px', (rect.left + rect.width * percent / 100 + (Math.random() - 0.5) * 6) + 'px');
  dot.style.setProperty('--py', (rect.top + rect.height / 2) + 'px');
  dot.style.setProperty('--dx', ((Math.random() - 0.5) * 10) + 'px');
  dot.style.setProperty('--dy', (-14 - Math.random() * 22) + 'px');
  document.body.appendChild(dot);
  setTimeout(function (el) { return function () { if (el && el.parentNode) el.parentNode.removeChild(el); }; }(dot), 900);
}
// ============================================================
//  粒子流进度条（progressStyle 'dots'：整条由粒子构成，颜色取封面）
//  已播段：粒子从起点向播放头持续漂移；播放头：火花四溅。
//  位置全部读 #progress-bar 的 --progress-percent（setProgressVisual 唯一写入），
//  因此轮询/timeupdate/拖拽 preview/settle 时钟全链路自动生效。
// ============================================================
var progressFlow = {
  active: false, canvas: null, ctx: null, w: 0, h: 0, cw: 0, raf: 0, lastT: 0,
  stream: [], sparks: [], streamAcc: 0, sparkAcc: 0,
  colorCache: { key: '', rgb: null }
};
// 画布相对进度条右侧外扩的余量（px）：给尾部呼吸粒子光晕留出溢出空间，避免被右边缘裁切
var PROGRESS_FLOW_TAIL_PAD = 14;
function progressFlowParseColor(value) {
  var s = String(value || '').trim();
  var m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}
function progressFlowPaletteRgb() {
  var pal = typeof stageLyrics !== 'undefined' && stageLyrics ? stageLyrics.coverPalette : null;
  var hex = (fx && fx.visualTintMode === 'custom')
    ? (fx.visualTintColor || '')
    : ((pal && (pal.rawPrimary || pal.primary)) || (fx && fx.visualTintColor) || '');
  var key = String(hex || '');
  if (progressFlow.colorCache.key === key && progressFlow.colorCache.rgb) return progressFlow.colorCache.rgb;
  var rgb = progressFlowParseColor(key) || { r: 170, g: 200, b: 230 };
  progressFlow.colorCache = { key: key, rgb: rgb };
  return rgb;
}
function progressFlowEnsureCanvas() {
  var bar = document.getElementById('progress-bar');
  if (!bar) return false;
  if (!progressFlow.canvas || progressFlow.canvas.parentNode !== bar) {
    var cv = document.createElement('canvas');
    cv.id = 'progress-flow-canvas';
    cv.setAttribute('aria-hidden', 'true');
    bar.appendChild(cv);
    progressFlow.canvas = cv;
    progressFlow.ctx = cv.getContext('2d');
    progressFlow.w = 0;
    progressFlow.h = 0;
  }
  return true;
}
function progressFlowHeadX() {
  var bar = document.getElementById('progress-bar');
  if (!bar || !progressFlow.w) return 0;
  var pct = parseFloat(bar.style.getPropertyValue('--progress-percent')) || 0;
  return Math.max(2, Math.min(progressFlow.w - 2, progressFlow.w * pct / 100));
}
function progressFlowSpawnStream(headX) {
  var rgb = progressFlowPaletteRgb();
  var sizeMult = (fx && isFinite(Number(fx.progressParticleSize)) && Number(fx.progressParticleSize) > 0)
    ? clampRange(Number(fx.progressParticleSize), 0.5, 2.2) : 1;
  var band = 4;
  progressFlow.stream.push({
    x: Math.random() * headX,
    y: progressFlow.h / 2 + (Math.random() - 0.5) * band,
    vx: 16 + Math.random() * 42,
    phase: Math.random() * Math.PI * 2,
    amp: 0.3 + Math.random() * 1.0,
    size: (0.7 + Math.random() * 0.6) * sizeMult,
    life: 0,
    maxLife: 1.0 + Math.random() * 1.4,
    bright: Math.random() < 0.1 ? 0.9 : 0.5 + Math.random() * 0.35,
    rgb: rgb,
    fillBase: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',1)'
  });
}
function progressFlowSpawnSpark(headX, boost) {
  var rgb = progressFlowPaletteRgb();
  var speed = (30 + Math.random() * 66) * (boost ? 1.2 : 1);
  var vx;
  var vy;
  if (fx && fx.progressSparkDirection === 'left') {
    // 向左模式：上下对称喷出（各一半），统一受向左的力缓慢漂移消散
    vy = (Math.random() < 0.5 ? -1 : 1) * speed * (0.35 + Math.random() * 0.65);
    vx = -speed * (0.12 + Math.random() * 0.3);
  } else {
    var angle = -Math.PI * (0.12 + Math.random() * 0.76);
    vx = Math.cos(angle) * speed * 0.6;
    vy = Math.sin(angle) * speed;
  }
  var sizeMult = (fx && isFinite(Number(fx.progressParticleSize)) && Number(fx.progressParticleSize) > 0)
    ? clampRange(Number(fx.progressParticleSize), 0.5, 2.2) : 1;
  progressFlow.sparks.push({
    x: headX + (Math.random() - 0.5) * 2,
    y: progressFlow.h / 2,
    vx: vx,
    vy: vy,
    size: (0.6 + Math.random() * 1.0) * sizeMult,
    life: 0,
    maxLife: 0.45 + Math.random() * 0.5,
    rgb: rgb
  });
}
function progressFlowTick(t) {
  if (!progressFlow.active) { progressFlow.raf = 0; return; }
  progressFlow.raf = requestAnimationFrame(progressFlowTick);
  var cv = progressFlow.canvas;
  var ctx = progressFlow.ctx;
  var bar = document.getElementById('progress-bar');
  if (!cv || !ctx || !bar || !bar.isConnected) return;
  var dpr = window.devicePixelRatio || 1;
  var cw = cv.clientWidth;
  var h = cv.clientHeight;
  if (!cw || !h) return;
  // 逻辑宽度 = 进度条本体宽度（画布右侧外扩 TAIL_PAD，粒子坐标仍以本体为准）
  var w = Math.max(0, cw - PROGRESS_FLOW_TAIL_PAD);
  if (w !== progressFlow.w || h !== progressFlow.h || cw !== progressFlow.cw || cv.width !== Math.round(cw * dpr)) {
    progressFlow.w = w;
    progressFlow.h = h;
    progressFlow.cw = cw;
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, cw, h);
  var dt = Math.min(0.05, (t - progressFlow.lastT) / 1000 || 0.016);
  progressFlow.lastT = t;
  var playing = !!(audio && !audio.paused && isFinite(audio.currentTime));
  var dragging = !!progressDragState.active;
  var headX = progressFlowHeadX();
  var rgb = progressFlowPaletteRgb();
  // 粒子密度：满进度条时的粒子总数；按已播占比分布（头尾密度一致，修"开头密后面疏"）
  var amount = (fx && isFinite(Number(fx.progressParticleAmount)) && Number(fx.progressParticleAmount) >= 0)
    ? clampRange(Math.round(Number(fx.progressParticleAmount)), 0, 500) : 110;
  var densityTarget = progressFlow.w > 0 ? Math.round(amount * headX / progressFlow.w) : 0;
  var glowBoost = (fx && isFinite(Number(fx.progressParticleBrightness)))
    ? clampRange(Number(fx.progressParticleBrightness), 0, 10) : 1;
  if (playing || dragging) {
    var target = densityTarget;
    progressFlow.streamAcc += dt * Math.max(60, target * 1.2);
    while (progressFlow.streamAcc >= 1) {
      progressFlow.streamAcc -= 1;
      if (progressFlow.stream.length < target) progressFlowSpawnStream(headX);
    }
    progressFlow.sparkAcc += dt * (dragging ? 26 : 8);
    while (progressFlow.sparkAcc >= 1) {
      progressFlow.sparkAcc -= 1;
      if (progressFlow.sparks.length < 36) progressFlowSpawnSpark(headX, dragging);
    }
  } else if (progressFlow.stream.length === 0 && headX > 8) {
    // 暂停且无粒子（刚切换模式/刚启动）：补一批静态粒子保证进度可读
    var fillCount = densityTarget;
    for (var k = 0; k < fillCount; k++) progressFlowSpawnStream(headX);
  }
  var i;
  var p;
  var alpha;
  var cheap = progressFlow.stream.length > 3000;
  for (i = progressFlow.stream.length - 1; i >= 0; i--) {
    p = progressFlow.stream[i];
    if (playing || dragging) {
      p.life += dt;
      p.x += p.vx * dt;
    }
    var fadeTail = p.life / p.maxLife;
    if (p.life >= p.maxLife || p.x > headX + 4) {
      progressFlow.stream.splice(i, 1);
      continue;
    }
    alpha = p.bright * Math.sin(Math.min(1, fadeTail) * Math.PI);
    if (p.x > headX - 12) alpha *= Math.max(0, (headX + 4 - p.x) / 16);
    if (alpha <= 0.01) continue;
    var py = progressFlow.h / 2 + Math.sin(p.phase + t * 0.003 + p.x * 0.02) * p.amp;
    ctx.globalCompositeOperation = 'lighter';
    if (cheap) {
      // 高数量模式：跳过光晕通道，方点直绘（1~2px 下与圆点观感一致）
      ctx.fillStyle = p.fillBase;
      ctx.globalAlpha = Math.min(1, alpha * 0.8 * glowBoost);
      ctx.fillRect(p.x - p.size, py - p.size, p.size * 2, p.size * 2);
      continue;
    }
    ctx.fillStyle = 'rgba(' + p.rgb.r + ',' + p.rgb.g + ',' + p.rgb.b + ',' + Math.min(1, alpha * 0.07 * glowBoost).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, py, p.size * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(' + Math.min(255, p.rgb.r + 50) + ',' + Math.min(255, p.rgb.g + 50) + ',' + Math.min(255, p.rgb.b + 50) + ',' + Math.min(1, alpha * 0.8 * glowBoost).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, py, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (i = progressFlow.sparks.length - 1; i >= 0; i--) {
    p = progressFlow.sparks[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      progressFlow.sparks.splice(i, 1);
      continue;
    }
    if (playing || dragging) {
      if (fx && fx.progressSparkDirection === 'left') {
        // 向左模式：受向左的力沿条缓慢滑落消散，竖直速度轻阻尼（上下两路都保留）
        p.vx -= 110 * dt;
        p.vy *= Math.max(0, 1 - 0.5 * dt);
      } else {
        p.vy += 300 * dt;
        p.vx *= Math.max(0, 1 - 1.6 * dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (p.life >= p.maxLife || p.x < -8) {
      progressFlow.sparks.splice(i, 1);
      continue;
    }
    alpha = Math.pow(1 - p.life / p.maxLife, 1.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + p.rgb.r + ',' + p.rgb.g + ',' + p.rgb.b + ',' + Math.min(1, alpha * 0.16 * glowBoost).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(' + Math.min(255, p.rgb.r + 50) + ',' + Math.min(255, p.rgb.g + 50) + ',' + Math.min(255, p.rgb.b + 50) + ',' + Math.min(1, alpha * 0.7 * glowBoost).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  // 播放头：一颗随进度移动的亮粒子（小光晕 + 白核），只在头部有火花
  var sizeMult = (fx && isFinite(Number(fx.progressParticleSize)) && Number(fx.progressParticleSize) > 0)
    ? clampRange(Number(fx.progressParticleSize), 0.5, 2.2) : 1;
  if (headX > 2) {
    var headPulse = 0.85 + 0.15 * Math.sin(t * 0.006);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (0.12 * headPulse).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(headX, progressFlow.h / 2, 4.5 * headPulse * sizeMult, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * headPulse).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(headX, progressFlow.h / 2, 1.4 * headPulse * sizeMult, 0, Math.PI * 2);
    ctx.fill();
  }
  // 进度条尾部：三颗呼吸闪跃粒子（亮度按 0 → 滑杆峰值(0~10) → 0 循环，同步呼吸）
  if (progressFlow.w > 8) {
    var tailBreathe = 0.5 - 0.5 * Math.cos(t * 0.001257); // 0..1 呼吸循环（5s 一个周期）
    var tailFlash = Math.pow(tailBreathe, 1.8); // 暗久亮短：呼吸中带"闪跃"感
    var tailBright = glowBoost * tailFlash; // 滑杆 0~10 直接作峰值亮度
    ctx.globalCompositeOperation = 'lighter';
    // 三颗粒子叠加在同一位置（终点处），同步呼吸，'lighter' 叠加出更亮的闪跃
    var tailDots = [
      { s: 1.1 },
      { s: 0.95 },
      { s: 0.8 }
    ];
    for (var ti = 0; ti < tailDots.length; ti++) {
      var td = tailDots[ti];
      var tx = progressFlow.w - 2;
      var ty = progressFlow.h / 2;
      ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + Math.min(1, 0.07 * tailBright).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(tx, ty, (3 + 1.6 * tailFlash) * sizeMult, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(' + Math.min(255, rgb.r + 50) + ',' + Math.min(255, rgb.g + 50) + ',' + Math.min(255, rgb.b + 50) + ',' + Math.min(1, 0.4 * tailBright).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(tx, ty, td.s * sizeMult, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}
function progressFlowSetActive(on) {
  var wanted = !!on;
  if (wanted === progressFlow.active && !!progressFlow.canvas === wanted) {
    if (wanted) progressFlowStartRaf();
    return;
  }
  progressFlow.active = wanted;
  if (wanted) {
    if (!progressFlowEnsureCanvas()) { progressFlow.active = false; return; }
    progressFlowStartRaf();
  } else {
    if (progressFlow.raf) { cancelAnimationFrame(progressFlow.raf); progressFlow.raf = 0; }
    if (progressFlow.canvas && progressFlow.canvas.parentNode) progressFlow.canvas.parentNode.removeChild(progressFlow.canvas);
    progressFlow.canvas = null;
    progressFlow.ctx = null;
    progressFlow.stream.length = 0;
    progressFlow.sparks.length = 0;
    progressFlow.streamAcc = 0;
    progressFlow.sparkAcc = 0;
  }
}
function progressFlowStartRaf() {
  if (progressFlow.raf || !progressFlow.active) return;
  progressFlow.lastT = performance.now();
  progressFlow.raf = requestAnimationFrame(progressFlowTick);
}
function renderProgressPreview(currentSec, durationSec) {
  currentSec = Math.max(0, Number(currentSec) || 0);
  durationSec = Math.max(0, Number(durationSec) || 0);
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
}
function progressPointerPreviewFromEvent(e) {
  var durationSec = getPlaybackDurationSeconds();
  if (!audio || !durationSec) return null;
  var bar = document.getElementById('progress-bar');
  if (!bar) return null;
  var rect = progressDragState.active && progressDragState.barRect
    ? progressDragState.barRect
    : bar.getBoundingClientRect();
  var width = Math.max(1, rect.width || 1);
  var ratio = clampRange((e.clientX - rect.left) / width, 0, 1);
  return { ratio: ratio, time: ratio * durationSec, duration: durationSec, rect: rect };
}
function queueProgressPointerPreview(e, emitParticles) {
  if (!e) return;
  progressDragState.pendingPointer = { clientX: Number(e.clientX) || 0, clientY: Number(e.clientY) || 0, emitParticles: !!emitParticles };
  if (progressDragState.pointerPreviewRaf) return;
  progressDragState.pointerPreviewRaf = requestAnimationFrame(function () {
    progressDragState.pointerPreviewRaf = 0;
    var pending = progressDragState.pendingPointer;
    progressDragState.pendingPointer = null;
    if (pending && progressDragState.active) previewProgressPointer(pending, pending.emitParticles);
  });
}
function flushProgressPointerPreview(e) {
  if (progressDragState.pointerPreviewRaf) {
    cancelAnimationFrame(progressDragState.pointerPreviewRaf);
    progressDragState.pointerPreviewRaf = 0;
  }
  var pending = progressDragState.pendingPointer;
  progressDragState.pendingPointer = null;
  if (e && isFinite(Number(e.clientX))) previewProgressPointer(e, false);
  else if (pending) previewProgressPointer(pending, false);
}
function previewProgressPointer(e, emitParticles) {
  var preview = progressPointerPreviewFromEvent(e);
  if (!preview) return false;
  progressDragState.previewTime = preview.time;
  progressDragState.previewDuration = preview.duration;
  progressDragState.previewClockRunning = false;
  renderProgressPreview(preview.time, preview.duration);
  // Beat-map cursors are committed once on pointer release.  Rewinding and
  // rescanning long beat arrays for every raw pointermove steals rAF time from
  // the continuous lyric track without changing audible playback.
  scheduleProgressLyricPreviewTick();
  if (emitParticles) emitProgressDragParticles(e.clientX, preview.rect.top + preview.rect.height / 2);
  return true;
}
function progressSeekTargetReached(media, targetTime, serial) {
  if (!media || serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, progressDragState.previewSettleMediaSrc)) return false;
  if (media.seeking || media.readyState < 2 || !isFinite(Number(media.currentTime))) return false;
  var current = Math.max(0, Number(media.currentTime) || 0);
  var target = Math.max(0, Number(targetTime) || 0);
  return current >= Math.max(0, target - 0.45) && current <= target + 1.5;
}
function waitForProgressSeekReady(media, targetTime, serial, timeoutMs) {
  if (!media) return Promise.resolve(false);
  if (progressSeekTargetReached(media, targetTime, serial)) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      media.removeEventListener('seeked', onReady);
      media.removeEventListener('timeupdate', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('loadeddata', onReady);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('error', onError);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      cleanup();
      resolve(!!ok);
    }
    function onReady() {
      if (progressSeekTargetReached(media, targetTime, serial)) finish(true);
    }
    function onError() { finish(false); }
    media.addEventListener('seeked', onReady, { once: true });
    media.addEventListener('timeupdate', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('loadeddata', onReady);
    media.addEventListener('playing', onReady);
    media.addEventListener('error', onError, { once: true });
    timer = setTimeout(function () { finish(progressSeekTargetReached(media, targetTime, serial)); }, timeoutMs || 1800);
  });
}
function progressSeekMediaStillCurrent(media, mediaSrc) {
  return !!(media && audio === media && (media.currentSrc || media.src || '') === mediaSrc);
}
function restoreProgressSeekAudio(media, mediaSrc, resumeAfterSeek, serial) {
  if (serial !== progressDragState.commitSerial) return;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold(serial);
    return;
  }
  if (!resumeAfterSeek) {
    progressDragState.resumePlaySerial = 0;
    finishProgressPreviewHold(serial, 96);
    try { if (media && !media.paused) media.pause(); } catch (pauseErr) { }
    if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return;
  }
  if (progressDragState.resumePlaySerial !== serial || (media && media.paused)) {
    primeProgressSeekPlayback(media, mediaSrc, serial);
  }
  finishProgressPreviewHold(serial, 96);
}
function primeProgressSeekPlayback(media, mediaSrc, serial) {
  if (serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) return false;
  progressDragState.resumePlaySerial = serial;
  if (typeof attemptAudioPlay === 'function') {
    attemptAudioPlay({ manual: true, silent: true, fade: true });
    return true;
  }
  try {
    var playResult = media.play();
    if (playResult && playResult.then) {
      playResult.then(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof startPlaybackFadeIn === 'function') startPlaybackFadeIn();
        else if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      }).catch(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      });
    }
    return true;
  } catch (e) {
    finishProgressPreviewHold(serial, 48);
    if (progressSeekMediaStillCurrent(media, mediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return false;
  }
}
function commitProgressSeek(targetTime, resumeAfterSeek) {
  var media = progressDragState.media || audio;
  if (!media) return;
  var durationSec = progressDragState.previewDuration || getPlaybackDurationSeconds();
  if (!durationSec) return;
  targetTime = clampRange(Number(targetTime) || 0, 0, durationSec);
  var mediaSrc = progressDragState.mediaSrc || (media.currentSrc || media.src || '');
  var serial = ++progressDragState.commitSerial;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    return false;
  }
  progressDragState.previewTime = targetTime;
  progressDragState.previewDuration = durationSec;
  beginProgressPreviewHold(serial, 2800, !!resumeAfterSeek, media, mediaSrc, targetTime);
  if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
  try {
    media.currentTime = targetTime;
  } catch (err) {
    console.warn('[ProgressSeek] commit failed:', err && (err.message || err));
    progressDragState.previewClockRunning = false;
    finishProgressPreviewHold(serial, 48);
    restoreProgressSeekAudio(media, mediaSrc, false, serial);
    return;
  }
  if (resumeAfterSeek) primeProgressSeekPlayback(media, mediaSrc, serial);
  renderProgressPreview(targetTime, durationSec);
  syncBeatMapPlaybackCursor(targetTime, true);
  saveLastPlaybackSnapshot(true, 'seek');
  waitForProgressSeekReady(media, targetTime, serial, 1800).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return false;
    if (ready) return true;
    try { media.currentTime = targetTime; } catch (retryErr) { }
    return waitForProgressSeekReady(media, targetTime, serial, 1200);
  }).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
    if (!ready) console.warn('[ProgressSeek] target did not settle before fallback handoff');
    restoreProgressSeekAudio(media, mediaSrc, !!resumeAfterSeek && !!ready, serial);
  });
}
var progressBar = document.getElementById('progress-bar');
progressBar.addEventListener('pointerdown', function (e) {
  if (!audio || !getPlaybackDurationSeconds()) return;
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('manual-seek');
  if (
    typeof albumGaplessState !== 'undefined'
    && albumGaplessState
    && albumGaplessState.preload
    && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
    && typeof clearAlbumGaplessPreload === 'function'
  ) clearAlbumGaplessPreload('manual-seek');
  progressDragState.active = true;
  progressDragState.media = audio;
  progressDragState.mediaSrc = audio.currentSrc || audio.src || '';
  progressDragState.resumeAfterSeek = !!(audio && !audio.paused && !audio.ended && playing);
  progressDragState.previewTime = getPlaybackCurrentSeconds();
  progressDragState.previewDuration = getPlaybackDurationSeconds();
  progressDragState.barRect = progressBar.getBoundingClientRect();
  progressBar.classList.add('is-dragging');
  if (progressDragState.resumeAfterSeek) {
    if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
    try { audio.pause(); } catch (pauseErr) { }
  }
  try { progressBar.setPointerCapture(e.pointerId); } catch (err) { }
  previewProgressPointer(e, true);
  scheduleProgressLyricPreviewTick();
});
progressBar.addEventListener('pointermove', function (e) {
  if (!progressDragState.active) return;
  queueProgressPointerPreview(e, true);
});
function endProgressDrag(e, commit) {
  if (!progressDragState.active) return;
  flushProgressPointerPreview(e);
  var targetTime = progressDragState.previewTime;
  var resumeAfterSeek = progressDragState.resumeAfterSeek;
  var dragMedia = progressDragState.media;
  var dragMediaSrc = progressDragState.mediaSrc;
  progressDragState.active = false;
  progressDragState.barRect = null;
  progressBar.classList.remove('is-dragging');
  try { if (e && e.pointerId != null) progressBar.releasePointerCapture(e.pointerId); } catch (err) { }
  if (commit !== false) commitProgressSeek(targetTime, resumeAfterSeek);
  else {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    if (progressSeekMediaStillCurrent(dragMedia, dragMediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
  }
  progressDragState.media = null;
  progressDragState.mediaSrc = '';
  progressDragState.resumeAfterSeek = false;
  if (commit !== false && typeof scheduleCuefieldAutoMixPrepare === 'function') {
    scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 900);
  }
}
progressBar.addEventListener('pointerup', function (e) { endProgressDrag(e, true); });
progressBar.addEventListener('pointercancel', function (e) { endProgressDrag(e, false); });
progressBar.addEventListener('lostpointercapture', function (e) { endProgressDrag(e, true); });
setInterval(function () {
  if (!audio) {
    if (restoredLastPlaybackSnapshot && pendingPlaybackResumeAt > 0) applyRestoredPlaybackProgressUi(restoredLastPlaybackSnapshot);
    else updatePlaybackProgressUi();
    return;
  }
  if (progressDragState.active) {
    updatePlaybackProgressUi();
    return;
  }
  updateListenStatsTick(false);
  updatePlaybackProgressUi();
  if (typeof maybeEmitLaserParticles === 'function') maybeEmitLaserParticles();
  saveLastPlaybackSnapshot(false, 'tick');
  if (audio.currentTime) updateLyricsHighlight();
}, 200);

// ============================================================
//  文件拖放
