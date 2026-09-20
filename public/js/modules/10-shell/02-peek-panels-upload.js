// ============================================================
var PEEK_HIDE_DELAY = 170;
var PLAYLIST_PANEL_HIDE_DELAY = 100;
var peekTimers = { search: null, fx: null, pl: null };
var searchPeekRevealToken = 0;
var searchPeekRevealPending = false;
var PLAYLIST_PANEL_MOTION_MS = 360;
var PLAYLIST_PANEL_OPEN_ANIM_COOLDOWN = 520;
var PLAYLIST_PANEL_OPEN_DURATION_RANGE = { min: 0.08, max: 0.72, fallback: 0.28 };
var PLAYLIST_PANEL_CLOSE_DURATION_RANGE = { min: 0.06, max: 0.48, fallback: 0.18 };
function playlistPanelMotionRange(type) {
  return type === 'close' ? PLAYLIST_PANEL_CLOSE_DURATION_RANGE : PLAYLIST_PANEL_OPEN_DURATION_RANGE;
}
function playlistPanelMotionMs(type) {
  var key = type === 'close' ? 'playlistPanelCloseDuration' : 'playlistPanelOpenDuration';
  var range = playlistPanelMotionRange(type);
  var value = (typeof fx !== 'undefined' && fx && isFinite(fx[key])) ? Number(fx[key]) : range.fallback;
  return Math.round(clampRange(value, range.min, range.max) * 1000);
}
function playlistPeekHideDelay(key) {
  return key === 'pl' ? PLAYLIST_PANEL_HIDE_DELAY : PEEK_HIDE_DELAY;
}
function markPlaylistPanelMotion(panel, duration) {
  if (!panel) return;
  panel.__playlistMotionUntil = performance.now() + (duration == null ? PLAYLIST_PANEL_MOTION_MS : duration);
}
function isPlaylistPanelInMotion(panel) {
  return !!(panel && panel.__playlistMotionUntil && performance.now() < panel.__playlistMotionUntil);
}
function isPlaylistPanelOpeningMotion(panel) {
  return !!(isPlaylistPanelInMotion(panel) && !panel.classList.contains('playlist-panel-closing'));
}
function isSearchGlassReadyForReveal() {
  var root = document.documentElement;
  return !root.classList.contains('control-glass-svg-ok') ||
    root.classList.contains('search-glass-ready') ||
    root.classList.contains('search-glass-fallback');
}
function cancelPendingSearchPeekReveal() {
  searchPeekRevealToken += 1;
  searchPeekRevealPending = false;
}
function isSearchPeekRevealPending() {
  return searchPeekRevealPending;
}
function scheduleSearchPeekAfterGlassReady(el) {
  if (!el) return;
  var token = searchPeekRevealToken + 1;
  searchPeekRevealToken = token;
  searchPeekRevealPending = true;
  var startedAt = performance.now();
  function waitForGlass() {
    if (token !== searchPeekRevealToken) return;
    if (isSearchGlassReadyForReveal() || performance.now() - startedAt > 140) {
      searchPeekRevealPending = false;
      if (immersiveMode) return;
      el.classList.add('peek');
      return;
    }
    requestAnimationFrame(waitForGlass);
  }
  requestAnimationFrame(waitForGlass);
}
function shouldAnimatePlaylistPanelOpen(panel) {
  if (!panel) return false;
  var now = performance.now();
  if (panel.__lastOpenListAnimAt && now - panel.__lastOpenListAnimAt < PLAYLIST_PANEL_OPEN_ANIM_COOLDOWN) return false;
  panel.__lastOpenListAnimAt = now;
  return true;
}
// Home 与左侧歌单面板联动: 缓冲区连续跟随 (抽屉式 scrub)
// 鼠标 X ∈ [0, PLAYLIST_SCRUB_ZONE] 映射 p=1→0; 面板滑出与 home 旋转同步连续插值
var PLAYLIST_SCRUB_FULL_X = 420;
var PLAYLIST_SCRUB_RAMP = 150;
var PLAYLIST_SCRUB_FULL_HOME_X = 150;
var PLAYLIST_SCRUB_ZERO_HOME_X = 430;
var PLAYLIST_SCRUB_LERP = 0.18;
var playlistScrub = { p: 0, target: 0, raf: 0 };
document.documentElement.style.setProperty('--pl-scrub', '0');
function syncHomeRotationForPlaylistPanel() {
  document.body.classList.toggle('playlist-scrub-live', playlistScrub.p > 0.002);
}
function playlistScrubTargetForPointer(ex, ey, H) {
  if (playlistPanelPinned) return 1;
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) return 0;
  if (emptyHomeActive) {
    // home 场景: 只用左侧粒子边距做缓冲, 面板始终不会伸到 home 内容区(x≈340+)
    var homeRect = document.getElementById('empty-home').getBoundingClientRect();
    var fullX = Math.max(90, Math.round(homeRect.left * 0.45));
    var zeroX = Math.max(fullX + 120, Math.round(homeRect.left) + 90);
    // 吸附保持: 面板大部分已出且指针未离开面板范围 → 锁定全开, 操作时纹丝不动
    if (playlistScrub.p > 0.55 && ex <= zeroX) return 1;
    if (ex <= fullX) return 1;
    return Math.max(0, Math.min(1, 1 - (ex - fullX) / (zeroX - fullX)));
  }
  // 非 home(播放/沉浸): 面板右缘内恒全开, 其后 150px 渐变带抽屉跟随
  if (ex <= PLAYLIST_SCRUB_FULL_X) return 1;
  return Math.max(0, Math.min(1, 1 - (ex - PLAYLIST_SCRUB_FULL_X) / PLAYLIST_SCRUB_RAMP));
}
function playlistScrubSetTarget(t) {
  t = Math.max(0, Math.min(1, Number(t) || 0));
  playlistScrub.target = t;
  if (!playlistScrub.raf) playlistScrub.raf = requestAnimationFrame(playlistScrubTick);
  return t;
}
function playlistScrubTick() {
  playlistScrub.raf = 0;
  var s = playlistScrub;
  s.p += (s.target - s.p) * PLAYLIST_SCRUB_LERP;
  if (Math.abs(s.target - s.p) < 0.0015) s.p = s.target;
  document.documentElement.style.setProperty('--pl-scrub', s.p.toFixed(4));
  var panel = document.getElementById('playlist-panel');
  if (panel) {
    // 语义类滞回: peek/show 仅作可见性/内容准备语义, 位姿与透明度由 --pl-scrub 接管
    var peekOn = panel.classList.contains('peek') || panel.classList.contains('show');
    if (s.p > 0.12 && !peekOn && !playlistPanelPinned) {
      var firstOpen = !panel.dataset.preserveTabOnOpen;
      preparePlaylistPanelTabOnOpen(panel);
      panel.dataset.preserveTabOnOpen = '1';
      panel.classList.add('peek');
      var runAnim = shouldAnimatePlaylistPanelOpen(panel);
      scheduleUiWarmTask(function () {
        flushDeferredQueuePanel('playlist-panel-peek');
        if (runAnim) animatePlaylistPanelCurrentTab(panel, { scrollActive: false });
      }, 180);
    } else if (s.p < 0.06 && peekOn && !playlistPanelPinned) {
      panel.classList.remove('peek', 'show');
      panel.dataset.preserveTabOnOpen = '';
    }
    panel.classList.toggle('scrub-pointer', s.p > 0.1);
  }
  syncHomeRotationForPlaylistPanel();
  if (Math.abs(s.target - s.p) >= 0.0015) playlistScrub.raf = requestAnimationFrame(playlistScrubTick);
}
function setPeek(el, on, key) {
  if (!el) return;
  if (immersiveMode && on && (key === 'search' || key === 'fx')) return;
  if (on && !diyPlayerMode && key === 'fx') return;
  if (!on && key === 'search' && emptyHomeActive && !immersiveMode) return;
  if (!on && key === 'pl' && playlistPanelPinned) return;
  if (key === 'pl') {
    // 面板位姿由缓冲区跟随控制器接管: 这里只路由目标值并保留内容准备副作用,
    // peek 语义类由 playlistScrubTick 滞回管理
    if (on && !isPlaylistPanelActiveState(el)) preparePlaylistPanelTabOnOpen(el);
    playlistScrubSetTarget(on ? 1 : 0);
    return;
  }
  if (on && key === 'fx') document.body.classList.remove('fullscreen-diy-peek');
  if (on) {
    if (key === 'pl') resetSecondaryPlaylistEdgeGuard();
    var wasPeek = el.classList.contains('peek');
    if (peekTimers[key]) { clearTimeout(peekTimers[key]); peekTimers[key] = null; }
    if (key === 'fx') el.classList.remove('closing');
    if (key === 'pl') el.classList.remove('playlist-panel-closing');
    if (key === 'search' && typeof prepareSearchGlassBeforePeek === 'function' && !wasPeek) {
      var searchGlassReady = prepareSearchGlassBeforePeek();
      if (!searchGlassReady) {
        scheduleSearchPeekAfterGlassReady(el);
        return;
      }
    }
    var runPlaylistOpenAnimation = key === 'pl' && !wasPeek ? shouldAnimatePlaylistPanelOpen(el) : false;
    if (key === 'pl' && !wasPeek) preparePlaylistPanelTabOnOpen(el);
    el.classList.add('peek');
    if (key === 'pl' && !wasPeek) markPlaylistPanelMotion(el, playlistPanelMotionMs('open'));
    if (key === 'pl') syncHomeRotationForPlaylistPanel();
    if (key === 'pl' && !wasPeek) {
      scheduleUiWarmTask(function () {
        flushDeferredQueuePanel('playlist-panel-peek');
        if (runPlaylistOpenAnimation) animatePlaylistPanelCurrentTab(el, { scrollActive: false });
      }, 180);
    }
    if (key === 'fx') {
      var fabOn = document.getElementById('fx-fab');
      if (fabOn) fabOn.classList.add('active');
    }
  } else {
    if (key === 'search') cancelPendingSearchPeekReveal();
    if (key === 'pl') resetSecondaryPlaylistEdgeGuard();
    if (peekTimers[key]) clearTimeout(peekTimers[key]);
    peekTimers[key] = setTimeout(function () {
      if (key === 'pl') el.classList.add('playlist-panel-closing');
      el.classList.remove('peek');
      if (key === 'pl') {
        markPlaylistPanelMotion(el, playlistPanelMotionMs('close'));
        syncHomeRotationForPlaylistPanel();
      }
      if (key === 'pl') setTimeout(function () { el.classList.remove('playlist-panel-closing'); }, playlistPanelMotionMs('close') + 80);
      if (key === 'fx') {
        var fabOff = document.getElementById('fx-fab');
        if (fabOff && !el.classList.contains('show')) fabOff.classList.remove('active');
      }
      peekTimers[key] = null;
    }, playlistPeekHideDelay(key));
  }
}
function uploadTipWasSeen() {
  try { return localStorage.getItem(UPLOAD_TIP_STORE_KEY) === '1'; } catch (e) { return true; }
}
function markUploadTipSeen() {
  try { localStorage.setItem(UPLOAD_TIP_STORE_KEY, '1'); } catch (e) { }
}
function closeUploadTip(manual) {
  var tip = document.getElementById('upload-tip');
  if (uploadTipTimer) { clearTimeout(uploadTipTimer); uploadTipTimer = null; }
  if (manual) markUploadTipSeen();
  if (!tip || !tip.classList.contains('show')) return;
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.to(tip, {
      autoAlpha: 0,
      y: -8,
      scale: 0.98,
      duration: 0.24,
      ease: 'power2.in',
      overwrite: true,
      onComplete: function () {
        tip.classList.remove('show');
        window.gsap.set(tip, { clearProps: 'opacity,visibility,transform,filter' });
      }
    });
  } else {
    tip.classList.remove('show');
  }
}
function maybeShowUploadTipOnce() {
  if (!diyPlayerMode) return;
  if (uploadTipWasSeen()) return;
  if (immersiveMode) {
    setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  if (document.body.classList.contains('splash-active') || loginGuideAnimating) {
    setTimeout(maybeShowUploadTipOnce, 900);
    return;
  }
  var loginModal = document.getElementById('login-modal');
  var userModal = document.getElementById('user-modal');
  var coverModal = document.getElementById('cover-crop-modal');
  var hasModal = (loginModal && loginModal.classList.contains('show')) ||
    (userModal && userModal.classList.contains('show')) ||
    (coverModal && coverModal.classList.contains('show'));
  if (hasModal) {
    uploadTipAttempts++;
    if (uploadTipAttempts < 18) setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  var area = document.getElementById('search-area');
  var tip = document.getElementById('upload-tip');
  if (!area || !tip) return;
  markUploadTipSeen();
  setPeek(area, true, 'search');
  tip.classList.add('show');
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.fromTo(tip,
      { autoAlpha: 0, y: -10, scale: 0.975 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.62, ease: 'expo.out', overwrite: true }
    );
    var uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
      window.gsap.fromTo(uploadBtn,
        { scale: 1, boxShadow: '0 10px 32px rgba(0,0,0,.22)' },
        { scale: 1.07, boxShadow: '0 0 0 8px rgba(244,210,138,0),0 16px 46px rgba(244,210,138,.14)', duration: 0.58, ease: 'sine.inOut', yoyo: true, repeat: 3, overwrite: true }
      );
    }
  }
  uploadTipTimer = setTimeout(function () {
    uploadTipTimer = null;
    closeUploadTip(false);
    setPeek(area, false, 'search');
  }, 6800);
}
var secondaryPlaylistEdgeGuard = { enteredAt: 0, timer: null, x: 0, y: 0, H: 0 };
var SECONDARY_PLAYLIST_EDGE_MIN_X = 14;
var SECONDARY_PLAYLIST_EDGE_MAX_X = 112;
var SECONDARY_PLAYLIST_EDGE_DWELL_MS = 220;
var SECONDARY_PLAYLIST_SEAM_CLOSE_X = 6;
var PLAYLIST_PANEL_EDGE_TRIGGER_X = 104;
var PLAYLIST_PANEL_FULLSCREEN_EDGE_TRIGGER_X = 128;
var PLAYLIST_PANEL_HOME_EDGE_TRIGGER_X = 16;
var PLAYLIST_PANEL_FULLSCREEN_FOCUS_HOLD_X = 14;
var PLAYLIST_PANEL_FULLSCREEN_EDGE_LEAVE_TOLERANCE_X = -8;
var PLAYLIST_PANEL_BOTTOM_LEFT_BLOCK_X = 176;
function isPlaylistFullscreenEdgeMode() {
  return !!((typeof desktopRuntimeState !== 'undefined' && desktopRuntimeState && desktopRuntimeState.fullscreen) ||
    (typeof desktopFullscreenActive !== 'undefined' && desktopFullscreenActive) ||
    document.fullscreenElement ||
    document.body.classList.contains('desktop-fullscreen'));
}
function isSecondaryLeftDisplaySeamGuardActive() {
  var state = (typeof desktopWindowState !== 'undefined' && desktopWindowState) ? desktopWindowState : {};
  return !!(!isPlaylistFullscreenEdgeMode() && window.desktopWindow && window.desktopWindow.isDesktop && state.isPrimaryDisplay === false && state.hasDisplayOnLeft);
}
function resetSecondaryPlaylistEdgeGuard() {
  if (secondaryPlaylistEdgeGuard.timer) {
    clearTimeout(secondaryPlaylistEdgeGuard.timer);
    secondaryPlaylistEdgeGuard.timer = null;
  }
  secondaryPlaylistEdgeGuard.enteredAt = 0;
}
function playlistPanelEdgeTopGutter(H) {
  return Math.max(82, Math.min(132, Math.round(H * (isPlaylistFullscreenEdgeMode() ? 0.10 : 0.14))));
}
function playlistPanelEdgeBottomGutter(H) {
  return Math.max(104, Math.min(150, Math.round(H * (isPlaylistFullscreenEdgeMode() ? 0.13 : 0.16))));
}
function isPlaylistPanelBottomControlsConflict(ex, ey, H) {
  var nearBottomLeft = ey >= H - 112 && ex < PLAYLIST_PANEL_BOTTOM_LEFT_BLOCK_X;
  var handle = document.getElementById('bottom-handle');
  var bar = document.getElementById('bottom-bar');
  var handleRect = handle ? handle.getBoundingClientRect() : null;
  var barRect = bar ? bar.getBoundingClientRect() : null;
  var overHandle = !!(handleRect && ex >= handleRect.left - 28 && ex <= handleRect.right + 28 && ey >= handleRect.top - 18 && ey <= handleRect.bottom + 22);
  var barActive = !!((bar && bar.classList.contains('visible') && !bar.classList.contains('soft-hidden')) || document.body.classList.contains('controls-visible'));
  var overBarLeft = !!(barActive && barRect && ex >= barRect.left - 22 && ex <= Math.min(barRect.left + 300, barRect.right + 22) && ey >= barRect.top - 28 && ey <= barRect.bottom + 22);
  return nearBottomLeft || overHandle || overBarLeft;
}
function isSecondaryPlaylistSafeBandPoint(ex, ey, H) {
  return ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H) &&
    ex >= SECONDARY_PLAYLIST_EDGE_MIN_X && ex < SECONDARY_PLAYLIST_EDGE_MAX_X &&
    !isPlaylistPanelBottomControlsConflict(ex, ey, H);
}
function armSecondaryPlaylistEdgeDwell() {
  if (secondaryPlaylistEdgeGuard.timer) return;
  secondaryPlaylistEdgeGuard.timer = setTimeout(function () {
    secondaryPlaylistEdgeGuard.timer = null;
    if (!isSecondaryLeftDisplaySeamGuardActive()) return;
    if (!isSecondaryPlaylistSafeBandPoint(secondaryPlaylistEdgeGuard.x, secondaryPlaylistEdgeGuard.y, secondaryPlaylistEdgeGuard.H)) return;
    var panel = document.getElementById('playlist-panel');
    if (panel) setPeek(panel, true, 'pl');
  }, SECONDARY_PLAYLIST_EDGE_DWELL_MS);
}
function playlistPanelInitialEdgeTriggerX(defaultWidth, eventTarget) {
  if (!emptyHomeActive || !eventTarget || !eventTarget.closest || !eventTarget.closest('#empty-home')) return defaultWidth;
  var panel = document.getElementById('playlist-panel');
  if (isPlaylistPanelActiveState(panel)) return defaultWidth;
  return Math.min(defaultWidth, PLAYLIST_PANEL_HOME_EDGE_TRIGGER_X);
}
function isPlaylistEdgeTrigger(ex, ey, H, eventTarget) {
  var inVerticalBand = ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H);
  if (!inVerticalBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  if (isPlaylistFullscreenEdgeMode()) {
    resetSecondaryPlaylistEdgeGuard();
    return ex >= 0 && ex < playlistPanelInitialEdgeTriggerX(PLAYLIST_PANEL_FULLSCREEN_EDGE_TRIGGER_X, eventTarget);
  }
  if (!isSecondaryLeftDisplaySeamGuardActive()) {
    resetSecondaryPlaylistEdgeGuard();
    return ex >= 0 && ex < playlistPanelInitialEdgeTriggerX(PLAYLIST_PANEL_EDGE_TRIGGER_X, eventTarget);
  }
  if (ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  var inSafeBand = isSecondaryPlaylistSafeBandPoint(ex, ey, H);
  if (!inSafeBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  secondaryPlaylistEdgeGuard.x = ex;
  secondaryPlaylistEdgeGuard.y = ey;
  secondaryPlaylistEdgeGuard.H = H;
  var now = performance.now();
  if (!secondaryPlaylistEdgeGuard.enteredAt) secondaryPlaylistEdgeGuard.enteredAt = now;
  armSecondaryPlaylistEdgeDwell();
  return now - secondaryPlaylistEdgeGuard.enteredAt >= SECONDARY_PLAYLIST_EDGE_DWELL_MS;
}
function playlistPanelExitPadding() {
  return isSecondaryLeftDisplaySeamGuardActive() ? 28 : 46;
}
function playlistPanelFocusPadding() {
  return isSecondaryLeftDisplaySeamGuardActive() ? 30 : 42;
}
function isPlaylistPanelActiveState(panel) {
  return !!(panel && (panel.classList.contains('peek') || panel.classList.contains('show') || isPlaylistPanelOpeningMotion(panel)));
}
function isPlaylistFullscreenEdgeFocusHold(panel, ex, ey, H) {
  if (!isPlaylistFullscreenEdgeMode() || !isPlaylistPanelActiveState(panel)) return false;
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) return false;
  return ex >= PLAYLIST_PANEL_FULLSCREEN_EDGE_LEAVE_TOLERANCE_X && ex <= PLAYLIST_PANEL_FULLSCREEN_FOCUS_HOLD_X &&
    ey > playlistPanelEdgeTopGutter(H) && ey < H - playlistPanelEdgeBottomGutter(H);
}
function isFullscreenPlaylistQueueFocusLockedAtEdge(e) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || !isPlaylistPanelActiveState(panel)) return false;
  var ex = e && isFinite(e.clientX) ? e.clientX : 0;
  var ey = e && isFinite(e.clientY) ? e.clientY : (shelfHoverCue && isFinite(shelfHoverCue.y) ? shelfHoverCue.y : innerHeight * 0.5);
  return isPlaylistFullscreenEdgeFocusHold(panel, ex, ey, innerHeight);
}
function playlistPanelTargetRect(panel, currentRect) {
  currentRect = currentRect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  if (!panel) return currentRect;
  var width = panel.offsetWidth || currentRect.width || Math.max(0, currentRect.right - currentRect.left);
  var height = panel.offsetHeight || currentRect.height || Math.max(0, currentRect.bottom - currentRect.top);
  var left = isFinite(panel.offsetLeft) ? panel.offsetLeft : currentRect.left;
  var top = isFinite(panel.offsetTop) ? panel.offsetTop : currentRect.top;
  return { left: left, top: top, right: left + width, bottom: top + height, width: width, height: height };
}
function isPlaylistPanelPanelHit(panel, ppRect, ex, ey) {
  if (!isPlaylistPanelActiveState(panel)) return false;
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  return ex >= targetRect.left - 26 && ex <= targetRect.right + 28 && ey >= targetRect.top - 30 && ey <= targetRect.bottom + 30;
}
function isPlaylistPanelBridgeHit(panel, ppRect, ex, ey, H) {
  if (!isPlaylistPanelActiveState(panel)) return false;
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return false;
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  var top = Math.max(0, targetRect.top - 34);
  var bottom = Math.min(H, targetRect.bottom + 34);
  if (ey < top || ey > bottom) return false;
  return ex >= 0 && ex <= targetRect.right + playlistPanelFocusPadding();
}
function shouldClosePlaylistPanelFromPointer(ppOn, ex, ppRect, ey, H) {
  if (!ppOn) return false;
  var panel = document.getElementById('playlist-panel');
  var targetRect = playlistPanelTargetRect(panel, ppRect);
  if (isPlaylistPanelBottomControlsConflict(ex, ey, H)) return true;
  if (isPlaylistPanelOpeningMotion(panel) && ex < targetRect.right + playlistPanelFocusPadding()) return false;
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return true;
  return ex > targetRect.right + playlistPanelExitPadding();
}
function isPlaylistPanelFocusActive(inTrigger, inPanel, pp, ex, ppRect, ey, H) {
  if (isSecondaryLeftDisplaySeamGuardActive() && ex < SECONDARY_PLAYLIST_SEAM_CLOSE_X) return false;
  return inTrigger || inPanel || isPlaylistFullscreenEdgeFocusHold(pp, ex, ey, H);
}
function shouldHidePlaylistPanelOnWindowLeave(e) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || playlistPanelPinned) return false;
  if (!panel.classList.contains('peek') && !panel.classList.contains('show')) return false;
  if (e && e.relatedTarget) return false;
  if (!e) return true;
  if (isPlaylistFullscreenEdgeMode() && e.clientX <= 2 && e.clientY > playlistPanelEdgeTopGutter(window.innerHeight) && e.clientY < window.innerHeight - playlistPanelEdgeBottomGutter(window.innerHeight)) return false;
  return e.clientX <= 12 || e.clientX >= window.innerWidth - 2 || e.clientY <= 2 || e.clientY >= window.innerHeight - 2;
}
document.addEventListener('mouseleave', function (e) {
  if (shouldHidePlaylistPanelOnWindowLeave(e)) closePlaylistPanelSoft('window-leave');
}, true);
window.addEventListener('blur', function () {
  if (playlistPanelPinned) return;
  setTimeout(function () { closePlaylistPanelSoft('window-blur'); }, 60);
});
window.addEventListener('mousemove', function (e) {
  var sa = document.getElementById('search-area');
  var fp = document.getElementById('fx-panel');
  var pp = document.getElementById('playlist-panel');
  var ex = e.clientX, ey = e.clientY, W = innerWidth, H = innerHeight;
  updateUserCapsuleAutoHideFromPointer(ex, ey);
  updateFxFabAutoHideFromPointer(ex, ey);
  updateFullscreenDiyPeekFromPointer(ex, ey);
  if (document.body.classList.contains('splash-active')) {
    updateShelfHoverCueFromPointer(null);
    updateShelfCardHoverSelection(null);
    setFocusZone(null);
    return;
  }
  if (immersiveMode) {
    updateShelfHoverCueFromPointer(e);
    updateShelfCardHoverSelection(e);
    updateControlsAutoHideFromPointer(ex, ey);
    playlistScrubSetTarget(playlistScrubTargetForPointer(ex, ey, H));
    var shelfCanFocusImm = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    var newFocusImm = null;
    var queueFocusImm = playlistScrub.p >= 0.5;
    var shelfHoverFocusImm = !!(shelfCanFocusImm && isSideShelfFocusHit(e));
    if (queueFocusImm) newFocusImm = 'queue';
    else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) newFocusImm = 'shelf-detail';
    else if (shelfHoverFocusImm) newFocusImm = 'shelf-side';
    else if (shelfCanFocusImm && shelfManager.getMode() === 'stage' && ey > H * 0.55) newFocusImm = 'shelf-stage';
    setFocusZone(newFocusImm, newFocusImm === 'queue');
    return;
  }
  updateShelfHoverCueFromPointer(e);
  updateShelfCardHoverSelection(e);
  // 搜索 (上): 顶部 48px 内进入; 已显示时鼠标在 280px 内保留
  var saOn = sa.classList.contains('peek');
  var saRect = sa.getBoundingClientRect();
  var searchFocused = document.activeElement === $input;
  var uploadTip = document.getElementById('upload-tip');
  var uploadTipOpen = !!(uploadTip && uploadTip.classList.contains('show'));
  var uploadImportOpen = typeof isUploadImportActive === 'function' && isUploadImportActive();
  var inSearchPanel = saOn && ex >= saRect.left - 24 && ex <= saRect.right + 24 && ey >= saRect.top - 22 && ey <= saRect.bottom + 42;
  if (ey < 66 || inSearchPanel || searchFocused || uploadTipOpen || uploadImportOpen) setPeek(sa, true, 'search');
  else if ((saOn || isSearchPeekRevealPending()) && !emptyHomeActive) setPeek(sa, false, 'search');
  // 控制台: 右下角触发；一旦面板出现，就按真实面板矩形保留显示
  var fpOn = fp.classList.contains('peek') || fp.classList.contains('show');
  var fpRect = fp.getBoundingClientRect();
  var fab = document.getElementById('fx-fab');
  var fabRect = fab ? fab.getBoundingClientRect() : { left: W, right: W, top: H, bottom: H };
  var inFxPanel = fpOn && ex >= fpRect.left - 24 && ex <= fpRect.right + 24 && ey >= fpRect.top - 24 && ey <= fpRect.bottom + 24;
  var inFxFab = ex >= fabRect.left - 18 && ex <= fabRect.right + 18 && ey >= fabRect.top - 18 && ey <= fabRect.bottom + 18;
  var inFxBridge = fpOn && ex >= Math.min(fpRect.left, fabRect.left) - 18 && ex <= W && ey >= fpRect.bottom - 10 && ey <= fabRect.bottom + 18;
  if (!diyPlayerMode) inFxPanel = inFxFab = inFxBridge = false;
  if (inFxFab || inFxPanel || inFxBridge) setPeek(fp, true, 'fx');
  else if (fpOn) setPeek(fp, false, 'fx');
  // 歌单/队列 DOM 面板: 缓冲区连续跟随, 鼠标左移多出一点 / 右移收回一点
  playlistScrubSetTarget(playlistScrubTargetForPointer(ex, ey, H));

  // v8: 镜头跟拍触发判断
  //   - 队列面板 peek 时 → queue focus
  //   - 3D shelf side 模式只在点击展开后 → shelf-side
  //   - 3D shelf stage 模式 + 鼠标在下 35% → shelf-stage
  var shelfCanFocus = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
  if (!shelfCanFocus && !(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent())) {
    shelfPinnedOpen = false;
    if (fx) fx.shelfPinnedOpen = false;
  }

  var newFocus = null;
  // home 显示时禁用相机跟拍: 粒子背景保持静止, 只让 DOM home 旋转让位
  var queueFocusActive = playlistScrub.p >= 0.5 && !emptyHomeActive;
  var shelfHoverFocus = !!(shelfCanFocus && isSideShelfFocusHit(e));
  if (queueFocusActive) {
    newFocus = 'queue';
  } else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    newFocus = 'shelf-detail';
  } else if (shelfHoverFocus) {
    newFocus = 'shelf-side';
  } else if (shelfCanFocus && shelfManager.getMode() === 'stage' && ey > H * 0.55) {
    newFocus = 'shelf-stage';
  }
  setFocusZone(newFocus, newFocus === 'queue');
});

// ============================================================
//  启动页 (splash) 控制
