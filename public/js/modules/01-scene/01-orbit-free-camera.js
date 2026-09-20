// ============================================================
var orbit = {
  userTheta: 0.0, userPhi: 0.08, userRadius: 6.6,
  cineTheta: 0.0, cinePhi: 0.0, cineRadius: 0.0,
  theta: 0.0, phi: 0.08, radius: 6.6,
  minPhi: -Math.PI * 0.45, maxPhi: Math.PI * 0.45,
  minRadius: 0.1, maxRadius: 120,   // 缩放不设实际上下限 (滑杆/滚轮共用此范围)
  baselineTheta: 0.0, baselinePhi: 0.08, baselineRadius: 6.6,
  rotating: false, last: { x: 0, y: 0 },
  recentering: false,
  recenterStartedAt: 0,
  centerLocked: false,
  // v8: 镜头跟拍 (hover shelf / queue 时)
  lookAt: new THREE.Vector3(0, 0, 0),
  focus: {
    active: false,
    type: null,        // 'shelf-side' | 'shelf-stage' | 'queue'
    theta: 0.0, phi: 0.08, radius: 6.6,
    lookAt: new THREE.Vector3(0, 0, 0),
  },
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  beatGlow: 0,
};
var SONIC_ORBIT_BASELINE = { theta: 0.00, phi: 0.18, radius: 8.4 };
var ZERO_VEC = new THREE.Vector3(0, 0, 0);
var SONIC_CAMERA_LYRIC_LOOK_AT = new THREE.Vector3(0, 0, 0);
var BASE_FOV = 45;
var camPunch = 0;
var cinemaT = 0;
function defaultFreeCameraState() {
  return {
    active: false,
    locked: false,
    position: new THREE.Vector3(0, 0, 6.6),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV,
    velocity: new THREE.Vector3(),
    keys: {},
    resetTween: null
  };
}
function readFreeCameraState() {
  var state = defaultFreeCameraState();
  try {
    var raw = JSON.parse(localStorage.getItem(FREE_CAMERA_STORE_KEY) || '{}') || {};
    if (raw.position) {
      state.position.set(
        clampRange(Number(raw.position.x) || 0, -80, 80),
        clampRange(Number(raw.position.y) || 0, -80, 80),
        clampRange(Number(raw.position.z) || 6.6, -80, 80)
      );
    }
    state.yaw = clampRange(Number(raw.yaw) || 0, -Math.PI * 8, Math.PI * 8);
    state.pitch = clampRange(Number(raw.pitch) || 0, -Math.PI * 0.49, Math.PI * 0.49);
    state.roll = clampRange(Number(raw.roll) || 0, -Math.PI, Math.PI);
    state.fov = clampRange(Number(raw.fov) || BASE_FOV, 26, 72);
    state.locked = !!(raw.locked || raw.active);
    state.active = false;
  } catch (e) { }
  return state;
}
var freeCamera = readFreeCameraState();
var FREE_CAMERA_MOVE = new THREE.Vector3();
var FREE_CAMERA_TARGET_VEL = new THREE.Vector3();
var FREE_CAMERA_SHAKE_DIR = new THREE.Vector3();
var FREE_CAMERA_EULER = new THREE.Euler(0, 0, 0, 'YXZ');
var FREE_CAMERA_RESET_MAT = new THREE.Matrix4();
var FREE_CAMERA_RESET_QUAT = new THREE.Quaternion();
var FREE_CAMERA_UP = new THREE.Vector3(0, 1, 0);
var freeCameraPointer = { seen: false, x: 0, y: 0 };
var freeCameraDeferredSaveTimer = 0;
var freeCameraPointerLock = { desired: false, retryTimer: 0, lastRequestAt: 0 };

function sonicPresetCameraActive() {
  return !!(typeof SONIC_PRESET_INDEX !== 'undefined' && fx && Number(fx.preset) === SONIC_PRESET_INDEX);
}

function readSonicLyricLookAtTarget(out) {
  if (!sonicPresetCameraActive()) return false;
  if (fx && fx.lyricCameraLock) return false;
  if (typeof shouldUseWallpaperLyricCameraLock === 'function' && shouldUseWallpaperLyricCameraLock()) return false;
  if (typeof stageLyrics === 'undefined' || !stageLyrics || !stageLyrics.group) return false;
  if (!fx || !fx.particleLyrics) return false;
  if (!stageLyrics.current && !(stageLyrics.outgoing && stageLyrics.outgoing.length)) return false;
  var group = stageLyrics.group;
  if (group.updateMatrixWorld) group.updateMatrixWorld(true);
  if (group.getWorldPosition) {
    group.getWorldPosition(out);
  } else if (group.position && out.copy) {
    out.copy(group.position);
  } else {
    return false;
  }
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) return false;
  out.x = clampRange(out.x, -2.4, 2.4);
  out.y = clampRange(out.y - 0.18, -1.55, 1.25);
  out.z = clampRange(out.z + 0.10, -2.6, 1.55);
  return true;
}

function freeCameraPointerLockElement() {
  return typeof renderer !== 'undefined' && renderer && renderer.domElement ? renderer.domElement : document.body;
}

function freeCameraPointerLockActive() {
  var el = freeCameraPointerLockElement();
  return !!document.pointerLockElement && (document.pointerLockElement === el || document.pointerLockElement === document.body);
}

function clearFreeCameraPointerLockRetry() {
  if (freeCameraPointerLock.retryTimer) {
    clearTimeout(freeCameraPointerLock.retryTimer);
    freeCameraPointerLock.retryTimer = 0;
  }
}

function scheduleFreeCameraPointerLockRetry(delay) {
  clearFreeCameraPointerLockRetry();
  if (!freeCamera || !freeCamera.active || !freeCameraPointerLock.desired) return;
  freeCameraPointerLock.retryTimer = setTimeout(function () {
    freeCameraPointerLock.retryTimer = 0;
    requestFreeCameraPointerLock('retry');
  }, Math.max(120, delay || 260));
}

function requestFreeCameraPointerLock(reason) {
  if (!freeCamera || !freeCamera.active) return false;
  var el = freeCameraPointerLockElement();
  if (!el || !el.requestPointerLock || freeCameraPointerLockActive()) return freeCameraPointerLockActive();
  freeCameraPointerLock.desired = true;
  var now = performance.now();
  if (now - freeCameraPointerLock.lastRequestAt < 180) return false;
  freeCameraPointerLock.lastRequestAt = now;
  try {
    el.focus && el.focus({ preventScroll: true });
  } catch (e) {
    try { el.focus && el.focus(); } catch (ignore) { }
  }
  try {
    var lockResult = el.requestPointerLock();
    if (lockResult && lockResult.catch) {
      lockResult.catch(function () {
        freeCameraPointer.seen = false;
        scheduleFreeCameraPointerLockRetry(360);
      });
    }
    return true;
  } catch (e) {
    freeCameraPointer.seen = false;
    scheduleFreeCameraPointerLockRetry(360);
    return false;
  }
}

function releaseFreeCameraPointerLock() {
  freeCameraPointerLock.desired = false;
  clearFreeCameraPointerLockRetry();
  freeCameraPointer.seen = false;
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch (e) { }
}

document.addEventListener('pointerlockchange', function () {
  freeCameraPointer.seen = false;
  if (freeCamera && freeCamera.active && freeCameraPointerLock.desired && !freeCameraPointerLockActive()) {
    scheduleFreeCameraPointerLockRetry(240);
  }
});

document.addEventListener('pointerlockerror', function () {
  freeCameraPointer.seen = false;
  if (freeCamera && freeCamera.active && freeCameraPointerLock.desired) scheduleFreeCameraPointerLockRetry(420);
});

function saveFreeCameraState() {
  if (!freeCamera) return;
  try {
    localStorage.setItem(FREE_CAMERA_STORE_KEY, JSON.stringify({
      locked: !!freeCamera.locked,
      active: !!freeCamera.active,
      position: { x: freeCamera.position.x, y: freeCamera.position.y, z: freeCamera.position.z },
      yaw: freeCamera.yaw,
      pitch: freeCamera.pitch,
      roll: freeCamera.roll,
      fov: freeCamera.fov
    }));
  } catch (e) { }
}
function scheduleFreeCameraStateSave(delay) {
  if (freeCameraDeferredSaveTimer) return;
  freeCameraDeferredSaveTimer = setTimeout(function () {
    freeCameraDeferredSaveTimer = 0;
    saveFreeCameraState();
  }, delay || 720);
}
function easeOutCubic01(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
// 默认视图 = 全景: 各预设基准半径已按原值 ×1.55 放大 (滚轮/缩放滑杆在此基础上调)
function defaultOrbitStateForPreset(p) {
  p = Number(p) || 0;
  if (p === 1) return { theta: 0.0, phi: 0.03, radius: 9.6 };
  if (p === 2) return { theta: 0.0, phi: 0.15, radius: 10.9 };
  if (p === 3) return { theta: 0.0, phi: 0.05, radius: 12.4 };
  if (p === 4) return { theta: 0.0, phi: 0.04, radius: 10.1 };
  if (p === 6) return { theta: 0.18, phi: 0.10, radius: 11.5 };
  if (p === 9) return { theta: 0.0, phi: 0.06, radius: 13.0 };
  if (typeof SONIC_PRESET_INDEX !== 'undefined' && p === SONIC_PRESET_INDEX) {
    return {
      theta: SONIC_ORBIT_BASELINE.theta,
      phi: SONIC_ORBIT_BASELINE.phi,
      radius: 13.0
    };
  }
  return { theta: 0.0, phi: 0.08, radius: 10.2 };
}
// 固定缩放: 开启后启动/回正/切预设都使用用户固定的相机距离 (fx.zoomRadius)
function fixedZoomRadiusForFx() {
  if (typeof fx === 'undefined' || !fx || fx.zoomFixed !== true) return null;
  var v = Number(fx.zoomRadius);
  if (!isFinite(v) || v <= 0) return null;
  return clampRange(v, orbit.minRadius, orbit.maxRadius);
}
// ============ 分预设缩放记忆 ============
// 每个预设记住上次停留的相机半径 (滚轮/缩放滑杆), 切换预设/启动/回正时直接恢复;
// 从未调过的预设仍用各自的基准全景。与"统一调节"开关无关, 始终生效。
var FX_ZOOM_PRESET_STORE_KEY = 'mineradio-fx-zoom-v1';
var fxZoomPresetStore = {};
var fxZoomPresetLoaded = false;
var fxZoomPresetSaveTimer = null;
function fxZoomPresetLoad() {
  if (fxZoomPresetLoaded) return;
  fxZoomPresetLoaded = true;
  try {
    var raw = localStorage.getItem(FX_ZOOM_PRESET_STORE_KEY);
    if (raw) fxZoomPresetStore = JSON.parse(raw) || {};
  } catch (err) { fxZoomPresetStore = {}; }
}
function fxZoomPresetFlush() {
  fxZoomPresetSaveTimer = null;
  try { localStorage.setItem(FX_ZOOM_PRESET_STORE_KEY, JSON.stringify(fxZoomPresetStore)); } catch (err) {}
}
function fxZoomPresetScheduleSave() {
  if (fxZoomPresetSaveTimer) clearTimeout(fxZoomPresetSaveTimer);
  fxZoomPresetSaveTimer = setTimeout(fxZoomPresetFlush, 400);
}
function fxZoomPresetIndex() {
  var p = Number(fx && fx.preset) || 0;
  if (typeof presetMeta !== 'undefined' && presetMeta && presetMeta.length) {
    p = clampRange(Math.round(p), 0, presetMeta.length - 1);
  }
  return p;
}
function fxZoomRememberFor(p) {
  fxZoomPresetLoad();
  var v = Number(fxZoomPresetStore[p]);
  if (!isFinite(v) || v <= 0) return null;
  return clampRange(v, orbit.minRadius, orbit.maxRadius);
}
function fxZoomRememberCurrent() {
  if (typeof fx === 'undefined' || !fx) return;
  if (typeof orbit === 'undefined' || !orbit || !isFinite(orbit.userRadius) || orbit.userRadius <= 0) return;
  var v = clampRange(Math.round(orbit.userRadius * 100) / 100, orbit.minRadius, orbit.maxRadius);
  var p = fxZoomPresetIndex();
  fxZoomPresetLoad();
  if (fxZoomPresetStore[p] !== v) {
    fxZoomPresetStore[p] = v;
    fxZoomPresetScheduleSave();
  }
}
function fxClearZoomMemoryForCurrent() {
  fxZoomPresetLoad();
  var p = fxZoomPresetIndex();
  if (fxZoomPresetStore[p] !== undefined) {
    delete fxZoomPresetStore[p];
    fxZoomPresetScheduleSave();
  }
}
function fxZoomPresetClearAll() {
  fxZoomPresetLoad();
  fxZoomPresetStore = {};
  fxZoomPresetScheduleSave();
}
function applyPresetOrbitBaseline(p, opts) {
  opts = opts || {};
  if (p === 5) return false;
  var base = defaultOrbitStateForPreset(p);
  // 分预设缩放记忆优先; 从未调过且开了固定缩放时退回全局固定值
  var rememberedRadius = fxZoomRememberFor(p);
  if (rememberedRadius != null) base.radius = rememberedRadius;
  else {
    var fixedRadius = fixedZoomRadiusForFx();
    if (fixedRadius != null) base.radius = fixedRadius;
  }
  orbit.baselineTheta = base.theta;
  orbit.baselinePhi = clampRange(base.phi, orbit.minPhi, orbit.maxPhi);
  orbit.baselineRadius = clampRange(base.radius, orbit.minRadius, orbit.maxRadius);
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = orbit.baselinePhi;
  orbit.userRadius = orbit.baselineRadius;
  if (opts.syncCurrent) {
    orbit.theta = orbit.userTheta;
    orbit.phi = orbit.userPhi;
    orbit.radius = orbit.userRadius;
  }
  return true;
}
if (typeof fx !== 'undefined' && fx) applyPresetOrbitBaseline(fx.preset, { syncCurrent: true, startup: true });
// 滑杆/重置按钮: 把 fx.zoomRadius 应用到轨道相机 (实时平滑缩放, 不直接跳变 orbit.radius)
function applyFxZoomRadiusToOrbit(opts) {
  if (typeof fx === 'undefined' || !fx) return false;
  var v = Number(fx.zoomRadius);
  if (!isFinite(v) || v <= 0) return false;
  v = clampRange(v, orbit.minRadius, orbit.maxRadius);
  fx.zoomRadius = Math.round(v * 100) / 100;
  if (typeof unlockCenteredView === 'function') unlockCenteredView();
  orbit.userRadius = v;
  orbit.recentering = false;
  // 记到当前预设名下 (滑杆调节); 恢复默认时改为遗忘该预设的记忆
  if (opts && opts.forgetPreset) {
    if (typeof fxClearZoomMemoryForCurrent === 'function') fxClearZoomMemoryForCurrent();
  } else if (typeof fxZoomRememberCurrent === 'function') {
    fxZoomRememberCurrent();
  }
  return true;
}
function dampCameraImpulseForRecenter(strength) {
  var damp = clampRange(strength == null ? 0.36 : strength, 0, 1);
  orbit.cineTheta *= damp;
  orbit.cinePhi *= damp;
  orbit.cineRadius *= damp;
  camPunch *= damp;
  if (typeof beatCam !== 'undefined' && beatCam) {
    beatCam.thetaKick *= damp;
    beatCam.phiKick *= damp;
    beatCam.radiusKick *= damp;
    beatCam.rollKick *= damp;
    beatCam.punch *= damp;
  }
}
function settleOrbitRecenterTarget() {
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = clampRange(orbit.baselinePhi, orbit.minPhi, orbit.maxPhi);
  orbit.userRadius = clampRange(orbit.baselineRadius, orbit.minRadius, orbit.maxRadius);
  orbit.recentering = false;
  orbit.recenterStartedAt = 0;
}
function captureCurrentOrbitAsBaseline() {
  var theta = Number.isFinite(orbit.theta) ? orbit.theta - (orbit.cineTheta || 0) : orbit.userTheta;
  var phi = Number.isFinite(orbit.phi) ? orbit.phi - (orbit.cinePhi || 0) : orbit.userPhi;
  var radius = Number.isFinite(orbit.radius) ? orbit.radius - (orbit.cineRadius || 0) : orbit.userRadius;
  orbit.baselineTheta = theta;
  orbit.baselinePhi = clampRange(phi, orbit.minPhi, orbit.maxPhi);
  orbit.baselineRadius = clampRange(radius, orbit.minRadius, orbit.maxRadius);
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = orbit.baselinePhi;
  orbit.userRadius = orbit.baselineRadius;
  orbit.centerLocked = true;
  orbit.recentering = false;
}
function getDefaultFreeCameraResetPose() {
  var baseTheta = Number.isFinite(orbit.baselineTheta) ? orbit.baselineTheta : 0;
  var basePhi = clampRange(Number.isFinite(orbit.baselinePhi) ? orbit.baselinePhi : 0.08, orbit.minPhi, orbit.maxPhi);
  var baseRadius = clampRange(Number.isFinite(orbit.baselineRadius) ? orbit.baselineRadius : 6.6, orbit.minRadius, orbit.maxRadius);
  var baseCy = Math.cos(basePhi);
  var pose = {
    position: new THREE.Vector3(
      baseRadius * baseCy * Math.sin(baseTheta),
      baseRadius * Math.sin(basePhi),
      baseRadius * baseCy * Math.cos(baseTheta)
    ),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV
  };
  FREE_CAMERA_RESET_MAT.lookAt(pose.position, ZERO_VEC, FREE_CAMERA_UP);
  FREE_CAMERA_RESET_QUAT.setFromRotationMatrix(FREE_CAMERA_RESET_MAT);
  FREE_CAMERA_EULER.setFromQuaternion(FREE_CAMERA_RESET_QUAT, 'YXZ');
  pose.pitch = FREE_CAMERA_EULER.x;
  pose.yaw = FREE_CAMERA_EULER.y;
  pose.roll = FREE_CAMERA_EULER.z;
  if (typeof SKULL_PRESET_INDEX !== 'undefined' && fx && fx.preset === SKULL_PRESET_INDEX && typeof setSkullCameraTargetVectors === 'function') {
    var look = new THREE.Vector3();
    var shelfComposition = typeof isSkullShelfCompositionActive === 'function' && isSkullShelfCompositionActive();
    setSkullCameraTargetVectors(pose.position, look, innerHeight > innerWidth * 1.08, shelfComposition, 0);
    FREE_CAMERA_RESET_MAT.lookAt(pose.position, look, FREE_CAMERA_UP);
    FREE_CAMERA_RESET_QUAT.setFromRotationMatrix(FREE_CAMERA_RESET_MAT);
    FREE_CAMERA_EULER.setFromQuaternion(FREE_CAMERA_RESET_QUAT, 'YXZ');
    pose.pitch = FREE_CAMERA_EULER.x;
    pose.yaw = FREE_CAMERA_EULER.y;
    pose.roll = FREE_CAMERA_EULER.z;
  }
  return pose;
}
function syncOrbitAfterFreeCameraReset(pose) {
  dampCameraImpulseForRecenter(0.08);
  if (typeof clearCenteredViewOffsets === 'function') clearCenteredViewOffsets();
  if (typeof focusHover !== 'undefined' && focusHover) {
    focusHover.wantType = null;
    if (focusHover.pendingTimer) { clearTimeout(focusHover.pendingTimer); focusHover.pendingTimer = null; }
    if (focusHover.exitTimer) { clearTimeout(focusHover.exitTimer); focusHover.exitTimer = null; }
  }
  orbit.focus.active = false;
  orbit.focus.type = null;
  orbit.focus.lookAt.set(0, 0, 0);
  orbit.lookAt.set(0, 0, 0);
  orbit.centerLocked = true;
  orbit.recentering = false;
  orbit.recenterStartedAt = 0;
  if (typeof skullWheelZoomTarget !== 'undefined') {
    skullWheelZoomTarget = 0;
    if (!(fx && fx.preset === SKULL_PRESET_INDEX)) skullWheelZoom = 0;
  }
  if (fx && fx.preset === SKULL_PRESET_INDEX) {
    if (typeof resetSkullPresetView === 'function') resetSkullPresetView(false, { smooth: true, keepLyricLock: true });
    return;
  }
  if (!pose || !pose.position) return;
  var px = Number(pose.position.x) || 0;
  var py = Number(pose.position.y) || 0;
  var pz = Number(pose.position.z) || 0;
  var radius = clampRange(Math.sqrt(px * px + py * py + pz * pz) || orbit.baselineRadius || 6.6, orbit.minRadius, orbit.maxRadius);
  var theta = Math.atan2(px, pz);
  var phi = clampRange(Math.asin(clampRange(py / Math.max(0.001, radius), -1, 1)), orbit.minPhi, orbit.maxPhi);
  orbit.baselineTheta = theta;
  orbit.baselinePhi = phi;
  orbit.baselineRadius = radius;
  orbit.userTheta = theta;
  orbit.userPhi = phi;
  orbit.userRadius = radius;
  orbit.theta = theta;
  orbit.phi = phi;
  orbit.radius = radius;
  if (typeof resetSkullPresetView === 'function') resetSkullPresetView(true);
  if ((fx && fx.lyricCameraLock) || shouldUseWallpaperLyricCameraLock()) requestStageLyricCameraSnap(14);
}
function captureFreeCameraFromCurrent() {
  if (!freeCamera) freeCamera = defaultFreeCameraState();
  camera.updateMatrixWorld(true);
  freeCamera.position.copy(camera.position);
  FREE_CAMERA_EULER.setFromQuaternion(camera.quaternion, 'YXZ');
  freeCamera.pitch = FREE_CAMERA_EULER.x;
  freeCamera.yaw = FREE_CAMERA_EULER.y;
  freeCamera.roll = FREE_CAMERA_EULER.z;
  freeCamera.fov = clampRange(camera.fov || BASE_FOV, 26, 72);
}
function applyFreeCameraToCamera() {
  if (!freeCamera || !(freeCamera.active || freeCamera.locked)) return false;
  var cameraShake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  camera.position.copy(freeCamera.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    freeCamera.pitch + beatCam.phiKick * cameraShake * 0.45,
    freeCamera.yaw + beatCam.thetaKick * cameraShake * 0.45,
    freeCamera.roll + beatCam.rollKick * cameraShake
  );
  if (cameraShake > 0 && Math.abs(beatCam.radiusKick) > 0.0001) {
    FREE_CAMERA_SHAKE_DIR.set(0, 0, -1).applyEuler(camera.rotation);
    camera.position.addScaledVector(FREE_CAMERA_SHAKE_DIR, beatCam.radiusKick * cameraShake * 0.52);
  }
  var cameraPunch = Math.max(camPunch * 0.55, beatCam.punch * 0.54 + beatCam.radiusKick * 0.16) * cameraShake;
  var targetFov = clampRange(freeCamera.fov || BASE_FOV, 26, 72) - cameraPunch * 1.75;
  camera.fov += (targetFov - camera.fov) * (targetFov < camera.fov ? 0.24 : 0.12);
  camera.updateProjectionMatrix();
  camPunch *= 0.86;
  return true;
}
function updateFreeCameraHint() {
  var el = document.getElementById('free-camera-hint');
  if (el) el.classList.toggle('show', !!(freeCamera && freeCamera.active));
}
function resetFreeCameraToDefault() {
  if (!freeCamera) return;
  if (freeCameraDeferredSaveTimer) {
    clearTimeout(freeCameraDeferredSaveTimer);
    freeCameraDeferredSaveTimer = 0;
  }
  var fromPos = freeCamera.position ? freeCamera.position.clone() : new THREE.Vector3(0, 0, 6.6);
  var resetPose = getDefaultFreeCameraResetPose();
  freeCamera.resetTween = {
    start: performance.now(),
    duration: 620,
    from: {
      position: fromPos,
      yaw: Number(freeCamera.yaw) || 0,
      pitch: Number(freeCamera.pitch) || 0,
      roll: Number(freeCamera.roll) || 0,
      fov: Number(freeCamera.fov) || BASE_FOV
    },
    to: {
      position: resetPose.position,
      yaw: resetPose.yaw,
      pitch: resetPose.pitch,
      roll: resetPose.roll,
      fov: resetPose.fov
    }
  };
  freeCamera.active = false;
  freeCamera.locked = true;
  freeCamera.keys = {};
  if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
  releaseFreeCameraPointerLock();
  updateFreeCameraHint();
  showToast('自由镜头正在平滑回正');
}
function toggleFreeCamera() {
  if (!freeCamera) freeCamera = defaultFreeCameraState();
  if (freeCamera.active) {
    freeCamera.active = false;
    freeCamera.locked = true;
    freeCamera.keys = {};
    if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
    releaseFreeCameraPointerLock();
    saveFreeCameraState();
    updateFreeCameraHint();
    showToast('自由镜头已固定');
    return;
  }
  captureFreeCameraFromCurrent();
  freeCamera.active = true;
  freeCamera.locked = true;
  freeCamera.resetTween = null;
  freeCamera.keys = {};
  freeCameraPointer.seen = false;
  if (!freeCamera.velocity) freeCamera.velocity = new THREE.Vector3();
  try { renderer.domElement.focus && renderer.domElement.focus({ preventScroll: true }); } catch (e) {
    try { renderer.domElement.focus && renderer.domElement.focus(); } catch (ignore) { }
  }
  saveFreeCameraState();
  updateFreeCameraHint();
  requestFreeCameraPointerLock('toggle');
  showToast('自由镜头: WASD 移动 · 鼠标转向 · K 回正');
}
function updateFreeCamera(dt) {
  if (!freeCamera) return;
  if (freeCamera.resetTween) {
    var tw = freeCamera.resetTween;
    var t = easeOutCubic01((performance.now() - tw.start) / Math.max(1, tw.duration || 620));
    freeCamera.position.copy(tw.from.position).lerp(tw.to.position, t);
    freeCamera.yaw = tw.from.yaw + shortestAngleDelta(tw.from.yaw, tw.to.yaw) * t;
    freeCamera.pitch = tw.from.pitch + (tw.to.pitch - tw.from.pitch) * t;
    freeCamera.roll = tw.from.roll + shortestAngleDelta(tw.from.roll, tw.to.roll) * t;
    freeCamera.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * t;
    if (t >= 0.999) {
      freeCamera.position.copy(tw.to.position);
      freeCamera.yaw = tw.to.yaw;
      freeCamera.pitch = tw.to.pitch;
      freeCamera.roll = tw.to.roll;
      freeCamera.fov = tw.to.fov;
      syncOrbitAfterFreeCameraReset(tw.to);
      freeCamera.resetTween = null;
      freeCamera.active = false;
      freeCamera.locked = false;
      saveFreeCameraState();
      updateFreeCameraHint();
      showToast('自由镜头已回正');
    }
    return;
  }
  if (!freeCamera.active) return;
  var keys = freeCamera.keys || {};
  FREE_CAMERA_MOVE.set(0, 0, 0);
  if (keys.KeyW) FREE_CAMERA_MOVE.z -= 1;
  if (keys.KeyS) FREE_CAMERA_MOVE.z += 1;
  if (keys.KeyA) FREE_CAMERA_MOVE.x -= 1;
  if (keys.KeyD) FREE_CAMERA_MOVE.x += 1;
  if (keys.Space) FREE_CAMERA_MOVE.y += 1;
  if (keys.ControlLeft || keys.ControlRight) FREE_CAMERA_MOVE.y -= 1;
  if (!freeCamera.velocity) freeCamera.velocity = new THREE.Vector3();
  var targetVel = FREE_CAMERA_TARGET_VEL.set(0, 0, 0);
  if (FREE_CAMERA_MOVE.lengthSq() > 0) {
    FREE_CAMERA_MOVE.normalize();
    FREE_CAMERA_EULER.set(freeCamera.pitch, freeCamera.yaw, 0, 'YXZ');
    FREE_CAMERA_MOVE.applyEuler(FREE_CAMERA_EULER);
    var speed = (keys.ShiftLeft || keys.ShiftRight ? 6.2 : 2.35);
    targetVel.copy(FREE_CAMERA_MOVE).multiplyScalar(speed);
  }
  var ease = targetVel.lengthSq() > 0 ? 8.2 : 13.5;
  freeCamera.velocity.lerp(targetVel, clampRange(ease * Math.max(0.001, dt || 1 / 60), 0, 1));
  if (freeCamera.velocity.lengthSq() < 0.0004) freeCamera.velocity.set(0, 0, 0);
  freeCamera.position.addScaledVector(freeCamera.velocity, Math.max(0.001, dt || 1 / 60));
  var rollDir = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  if (rollDir) freeCamera.roll = clampRange(freeCamera.roll + rollDir * dt * 0.9, -Math.PI, Math.PI);
  scheduleFreeCameraStateSave(720);
}

// 一键视角回正: 退出自由相机, 注视点归零, 回到当前预设的默认轨道视角
function resetCameraView() {
  if (typeof freeCamera !== 'undefined' && freeCamera) {
    freeCamera.active = false;
    freeCamera.locked = false;
    freeCamera.keys = {};
    if (freeCamera.velocity) freeCamera.velocity.set(0, 0, 0);
    if (typeof releaseFreeCameraPointerLock === 'function') releaseFreeCameraPointerLock();
    if (typeof updateFreeCameraHint === 'function') updateFreeCameraHint();
  }
  if (typeof orbit !== 'undefined' && orbit) {
    orbit.centerLocked = false;
    orbit.recentering = false;
    if (orbit.lookAt) orbit.lookAt.set(0, 0, 0);
    if (orbit.focus) {
      orbit.focus.active = false;
      orbit.focus.type = null;
    }
    if (typeof clearCenteredViewOffsets === 'function') clearCenteredViewOffsets();
  }
  applyPresetOrbitBaseline(fx && fx.preset, { syncCurrent: true });
  if (typeof showToast === 'function') showToast('视角已回正');
}
