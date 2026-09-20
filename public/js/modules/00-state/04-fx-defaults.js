function normalizeWallpaperFps(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return 30;
  if (n <= 26) return 24;
  if (n <= 45) return 30;
  return 60;
}

var fxDefaults = {
  preset: 5,            // 0=emily cover, 1=tunnel, 2=orbit, 3=void, 4=vinyl, 5=wallpaper, 6=skull, 7=sonic topography, 8=sonic workshop, 9=phoenix
  presetOverlay: -1,    // 预设叠加层: -1=无, 否则叠加显示该预设的独立视觉层 (5/6/7/9)
  phoenixFlightPath: "none", // 凤凰横向轨迹: none=原地 circle=盘旋椭圆 patrol=左右巡游 (旧 phoenixFlightMode 自动迁移)
  phoenixFlightDive: true,  // 俯冲叠加开关 (可与盘旋/巡游同时开)
  phoenixFlightShowPath: false, // 显示轨迹虚线开关
  phoenixFlightSpeed: 0.3,   // 轨迹线速度倍率 0.3~2.5
  phoenixFlightAmp: 1.25,     // 轨迹幅度倍率 0.3~1.8
  phoenixFlightSize: 1.8,    // 盘旋椭圆横向半径倍数 1~5
  phoenixFlightTilt: 26,      // 椭圆长轴在屏幕面内的倾斜角度 0~90 度 (屏面参照)
  phoenixFlightSpin: 21,     // 椭圆旋出屏幕面的角度 0~90 度: 0=侧立成线 90=平铺屏面
  phoenixPosX: -3.67,            // 凤凰整体位置左右偏移 (世界单位, 悬停/盘旋/巡游/俯冲都生效)
  phoenixPosY: 1.07,            // 凤凰整体位置上下偏移 (向上为正)
  lyricAvoidPhoenix: false,   // 凤凰层激活且有歌词时, 歌词自动下移避让
  intensity: 0.6,
  particleCount: 0.86,   // 粒子数量保留比例 0.1~1.0, 着色器按 aRand 随机裁剪
  particleDensity: 1, // 粒子密度倍增 1.0~4.0, 几何层倍增粒子总数(网格上限 640)
  cinemaShake: 0,
  depth: 0.2,
  coverResolution: 1.55,
  point: 1.09, speed: 0.6, twist: 0.0, color: 1.10, scatter: 0.0, bgFade: 0,
  brightness: 3.65,
  phoenixColorMode: "cover", phoenixSolidColor: '#ffffff',
  phoenixRhythmMode: "sweep",
  bloomStrength: 0,
  lyricGlowStrength: 0,
  lyricBackgroundAdapt: 0.72,
  lyricScale: 0.7,
  lyricOffsetX: 0,
  lyricOffsetY: 0.03,
  lyricOffsetZ: 0,
  lyricTiltX: 0,
  lyricTiltY: 0,
  lyricKeepLevel: true, // 歌词保持水平: 朝向=垂直告示板, 不跟随封面平面/相机滚转旋转
  lyricColorMode: "auto",
  lyricColor: "#6d1f35",
  lyricHighlightMode: "auto",
  lyricHighlightColor: "#fff0b8",
  lyricGlowLinked: true,
  lyricGlowColor: "#9db8cf",
  lyricDisplayMode: "cinema",
  lyricTranslationMode: "multi",
  lyricMotionStyle: "shine",
  lyricCustomLineCount: 10,
  lyricGlitchCameraBind: true,
  lyricGlitchIntensity: 1,
  lyricGlitchSlice: 0.72,
  lyricGlitchChroma: 0.86,
  lyricGlitchRate: 1,
  lyricGlitchJitter: 0.72,
  lyricContextOpacity: 0.54,
  lyricContextSpread: 1.96,
  lyricTranslationGap: 0.92,
  lyricTranslationScale: 0.65,
  lyricTranslationOpacity: 0.86,
  lyricEdgeFade: 0.32,
  lyricMotionSoftness: 0.72,
  lyricFont: "stone-song",
  lyricLetterSpacing: 0,
  lyricLineHeight: 1,
  lyricWeight: 750,
  lyricTextureClarity: 4,
  visualTintMode: "auto",
  visualTintColor: "#9db8cf",
  uiAccentColor: "#ffffff",
  homeAccentColor: "#ffffff",
  homeIconColor: "#ffffff",
  visualIconColor: "#ffffff",
  backgroundColorMode: "cover",
  backgroundColor: "#000000",
  backgroundOpacity: 1,
  windowBackgroundOpacity: 1,
  backgroundGlassOpacity: 0,
  controlGlassChromaticOffset: 50,
  playlistPanelGlassBlur: 14,
  playlistPanelGlassDensity: 0.55,
  playlistPanelOpenDuration: 0.72,
  playlistPanelCloseDuration: 0.48,
  backgroundColorCustom: false,
  backgroundImage: "",
  backgroundMedia: null,
  backgroundAlbumCover: false,
  backgroundMediaCropX: 50,
  backgroundMediaCropY: 50,
  backgroundMediaZoom: 1,
  desktopLyrics: false,
  desktopLyricsSize: 1,
  desktopLyricsOpacity: 0.92,
  desktopLyricsY: 0.76,
  desktopLyricsClickThrough: false,
  desktopLyricsCinema: false,
  desktopLyricsHighlight: false,
  desktopLyricsFps: 0,
  playerShellStyle: "borderless",
  progressStyle: "dots",
  progressParticleAmount: 500,
  progressParticleBrightness: 1,
  progressParticleSize: 0.89,
  progressThickness: 1,
  progressSparkDirection: "down",
  wallpaperMode: false,
  wallpaperOpacity: 1,
  wallpaperFps: 60,
  floatLayer: false, cinema: false, edge: false, aiDepth: false, bloom: false, lyricGlow: true,
  lyricGlowBeat: true,
  lyricGlowParticles: false,
  lyricVerticalFloat: false,
  backgroundStarRiver: false,
  perPresetSplit: true, // 分预设视觉参数开关 (false=统一调节)
  zoomFixed: false,      // 固定缩放: 开启后每次启动/切预设/回正都用 zoomRadius 作为相机距离
  zoomRadius: 13.9,      // 视图缩放 (相机轨道半径, 即鼠标滚轮调整的距离; 默认=全景)
  lyricPauseHold: true,
  lyricCameraLock: false,
  sonicGroundAmplitude: 61,
  sonicGroundMotionSpeed: 36,
  sonicGroundDensity: 46,
  sonicGroundRange: 36,
  sonicGroundLower: 100,
  sonicGroundDepth: 62,
  sonicGroundAutoRotate: 50,
  sonicGroundColorMode: "cover",
  sonicGroundBaseColor: "#05070c",
  sonicGroundCoolColor: "#0066ff",
  sonicGroundWarmColor: "#ff3c19",
  sonicGroundAccentColor: "#33e6ff",
  sonicGroundGlow: 20,
  sonicGroundSubBass: 90,
  sonicGroundBass: 92,
  sonicGroundLowMid: 50,
  sonicGroundMid: 50,
  sonicGroundHighMid: 50,
  sonicGroundPresence: 25,
  sonicGroundBrilliance: 50,
  sonicGroundAir: 48,
  sonicGroundFloatingEnabled: true,
  sonicGroundFloatingIntensity: 36,
  sonicGroundFloatingMinSize: 9,
  sonicGroundFloatingMaxSize: 12,
  sonicGroundFloatingSpeed: 59,
  sonicGroundFloatingCount: 100,
  sonicAudioMonitorEnabled: true,
  sonicAudioAutoTrack: true,
  sonicAudioSensitivity: 100,
  sonicAudioBandStart: 1,
  sonicAudioBandEnd: 4,
  sonicAudioThreshold: 32,
  sonicAudioPulseStrength: 62,
  sonicWorkshopInputGain: 82,
  sonicWorkshopAudioIntensity: 1.15,
  sonicWorkshopResponseRange: 1.3,
  sonicWorkshopPeakIntensity: 0.62,
  sonicWorkshopColorMode: "cover",
  sonicWorkshopTheme: "minimal-monochrome",
  sonicWorkshopCustomColor: "#d9dde3",
  sonicWorkshopBaseColorMode: "cover",
  sonicWorkshopBaseColor: "#0b0c0e",
  sonicWorkshopWarmColorMode: "cover",
  sonicWorkshopWarmColor: "#d9dde3",
  sonicWorkshopCoolColorMode: "custom",
  sonicWorkshopCoolColor: "#ffffff",
  sonicWorkshopRippleColorMode: "cover",
  sonicWorkshopRippleColor: "#ffffff",
  sonicWorkshopPeakColorMode: "cover",
  sonicWorkshopPeakColor: "#f2f5f8",
  particleLyrics: true,    // v7.2: 粒子歌词
  backCover: false,        // 旧的封面背面粒子层关闭；浮空粒子层会跟随封面翻转
  shelf: "side",
  shelfPinnedOpen: false,
  shelfCameraMode: "dynamic",
  shelfPresence: "auto",
  shelfShowPodcasts: false,
  shelfMergeCollections: true,
  shelfSize: 0.92,
  shelfOffsetX: -0.34,
  shelfOffsetY: -0.2,
  shelfOffsetZ: 0.12,
  shelfAngleY: -11,
  shelfAngleYManual: true,
  shelfOpacity: 1,
  shelfBgOpacity: 0.79,
  shelfAccentColor: "#ffffff",
  shelfDetailOffsetX: 0,
  shelfDetailOffsetY: 0,
  shelfDetailOffsetZ: 0,
  shelfDetailScale: 1.35,
  shelfDetailAngleX: 0,
  shelfDetailAngleY: -13,
  shelfDetailRowGap: 1,
  shelfDetailOpenDuration: 0.6,
  shelfDetailCloseDuration: 0.18,
  shelfDetailRowDuration: 0.72,
  shelfDetailIntroStrength: 1,
  shelfDetailParallax: 1,
  shelfSummonOpenDuration: 0.91,
  shelfSummonCloseDuration: 0.46,
  shelfSummonSlide: 1.9,
  shelfSummonStagger: 1,
  shelfSummonScale: 1,
  shelfSummonParallax: 1,
  shelfCameraEnterSpeed: 0.24,
  shelfCameraExitSpeed: 0.24,
  performanceBackground: "release",
  performanceQuality: "ultra",
  foregroundFpsMode: "90",
  memoryAutoTrimApp: true,
  memoryAutoTrimOnBackground: true,
  memoryAutoSystemTrim: true,
  memorySystemAutoElevate: true,
  memorySystemIntervalMin: 30,
  memorySystemThresholdPercent: 78,
  memorySystemMask: 29,
  memorySafetyRevision: 3,
  liveBackgroundKeep: false,
  cam: "off",
};
function normalizeForegroundFpsMode(value) {
  var mode = String(value || '').trim().toLowerCase();
  if (mode === 'vsync' || mode === 'adaptive') return mode;
  if (/^(45|60|75|90|120)$/.test(mode)) return mode;
  return fxDefaults.foregroundFpsMode || 'vsync';
}
function foregroundFixedFpsForMode(mode) {
  mode = normalizeForegroundFpsMode(mode);
  if (mode === 'vsync') return 0;
  if (mode === 'adaptive') return null;
  return Math.max(1, Number(mode) || 60);
}

// ---- 预设叠加层 ----
// 会独占画面(隐藏基础粒子)的对象型预设; 音域回响(7)按原设计允许与基础粒子共存
function fxPresetHidesBaseParticles(p) {
  return p === 6 || p === 8 || p === 9;
}
function getFxPresetOverlay() {
  if (!fx) return -1;
  var v = Number(fx.presetOverlay);
  return isFinite(v) ? Math.round(clampRange(v, -1, 9)) : -1;
}
// 某预设的独立视觉层是否应显示 (主预设 或 叠加层)
function fxLayerActiveFor(idx) {
  return !!fx && (Number(fx.preset) === idx || getFxPresetOverlay() === idx);
}
// 主粒子系统当前应呈现的预设 (基础预设独占画面时, 若叠加了粒子型预设则显示叠加层的粒子)
function fxMainParticlePreset() {
  var base = Number(fx && fx.preset) || 0;
  if (!fxPresetHidesBaseParticles(base)) return base;
  var ov = getFxPresetOverlay();
  return (ov >= 0 && ov <= 5) ? ov : base;
}
// 层参数上下文: 无叠加时主层用全局实时值 (滑杆即时生效); 叠加激活时各层冻结在各自预设的快照上
// (全局此时是叠加层的参数上下文, 由 setFxPresetOverlay 切换)
function fxLayerFx(idx) {
  if (!fx || fx.perPresetSplit !== true) return fx;
  var ov = (typeof getFxPresetOverlay === 'function') ? getFxPresetOverlay() : -1;
  if (Number(fx.preset) === idx && ov < 0) return fx;
  try {
    if (typeof fxPerPresetStore === 'undefined') return fx;
    if (typeof fxPerPresetLoad === 'function') fxPerPresetLoad();
    var snap = fxPerPresetStore ? fxPerPresetStore[idx] : null;
    if (!snap) return fx;
    var o = Object.assign({}, fx);
    for (var k in snap) o[k] = snap[k];
    o.preset = Number(fx.preset);          // 结构字段保持全局 (层激活判定一致)
    o.presetOverlay = ov;
    return o;
  } catch (e) { return fx; }
}

// 亮度滑杆重映射: 滑杆 0~5 → 实际 0~3 (感知敏感区放大), 滑杆 5~10 → 实际 3~10 (无感区压缩)
function fxBrightnessFromSlider(v) {
  v = clampRange(Number(v) || 0, 0, 10);
  return v <= 5 ? v * 0.6 : 3 + (v - 5) * 1.4;
}
