function buildPresetGrid() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var seen = {};
  var order = presetDisplayOrder.filter(function (id) {
    var ok = id >= 0 && id < presetMeta.length && !seen[id];
    seen[id] = true;
    return ok;
  });
  presetMeta.forEach(function (_, id) {
    if (!seen[id]) order.push(id);
  });
  grid.innerHTML = order.map(function (i) {
    var p = presetMeta[i];
    var name = p.nameHtml || p.name;
    var desc = p.descHtml || p.desc;
    return '<div class="preset-card" data-preset="' + i + '" onclick="setPreset(' + i + ')">' +
      '<div class="pc-icon">' + presetIcons[i] + '</div>' +
      '<div class="pc-name">' + name + '</div>' +
      '<div class="pc-desc">' + desc + '</div>' +
      '</div>';
  }).join('');
  refreshPresetGrid();
  if (typeof updateFxPerPresetToggleUI === 'function') updateFxPerPresetToggleUI();
  if (typeof updateFxPresetOverlayUI === 'function') updateFxPresetOverlayUI();
}
function refreshPresetGrid() {
  document.querySelectorAll('.preset-card').forEach(function (el) {
    el.classList.toggle('active', Number(el.dataset.preset) === fx.preset);
  });
}
function triggerPresetParticleTransition(fromPreset, toPreset) {
  presetTransition.active = true;
  presetTransition.start = uniforms.uTime.value;
  presetTransition.duration = toPreset === 5 ? 0.30 : 0.24;
  presetTransition.from = fromPreset;
  presetTransition.to = toPreset;
  var newVisual = toPreset >= 4;
  var wallpaperFlow = toPreset === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + (newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wallpaperFlow ? 0.05 : 0.15);
  camPunch = Math.max(camPunch, wallpaperFlow ? 0.04 : 0.12);
  for (var i = 0; i < 3; i++) {
    triggerRipple((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0.58 + Math.random() * 0.32);
  }
  var card = document.querySelector('.preset-card[data-preset="' + toPreset + '"]');
  if (card) {
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');
    setTimeout(function () { card.classList.remove('switching'); }, 760);
  }
}
function tickPresetTransition() {
  if (!presetTransition.active) return;
  var raw = (uniforms.uTime.value - presetTransition.start) / presetTransition.duration;
  var t = Math.max(0, Math.min(1, raw));
  var wave = Math.sin(t * Math.PI);
  var newVisual = presetTransition.to >= 4;
  var wallpaperFlow = presetTransition.to === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wave * (wallpaperFlow ? 0.045 : (newVisual ? 0.12 : 0.15)));
  uniforms.uPointScale.value = fx.point * (1 + wave * (wallpaperFlow ? 0.016 : 0.048));
  if (raw >= 1) {
    presetTransition.active = false;
    syncFxUniforms();
  }
}
function setPreset(p, opts) {
  opts = opts || {};
  p = Math.max(0, Math.min(presetMeta.length - 1, Number(p) || 0));
  var prev = fx.preset;
  var changed = prev !== p;
  // 分预设模式: 切换前不需要额外动作 (改动时已实时捕获), 切换后恢复目标预设的参数
  fx.preset = p;
  if (changed && fx.perPresetSplit === true) {
    fxPerPresetLoad();
    if (!fxPerPresetStore[p]) fxPerPresetStore[p] = fxCaptureSplitSnapshot(); // 首次切到该预设: 以当前值初始化
    else fxApplySplitSnapshot(fxPerPresetStore[p]);
    updateFxPerPresetToggleUI();
  }
  // 主预设与叠加层相同: 叠加失去意义, 自动清空 (在分预设恢复之后判定)
  if (getFxPresetOverlay() === p) fx.presetOverlay = -1;
  // 叠加仍激活: 全局参数切到叠加层上下文 (滑杆显示/编辑/捕获都归叠加层; 主层冻结在自己的快照)
  var ovCtx = getFxPresetOverlay();
  if (ovCtx >= 0 && fx.perPresetSplit === true) {
    fxPerPresetLoad();
    if (!fxPerPresetStore[ovCtx]) fxPerPresetStore[ovCtx] = fxCaptureSplitSnapshot();
    fxApplySplitSnapshot(fxPerPresetStore[ovCtx]);
    if (typeof updateFxInputs === 'function') updateFxInputs();
  }
  var ovIdx = getFxPresetOverlay();
  if (changed && prev === SKULL_PRESET_INDEX && p !== SKULL_PRESET_INDEX && ovIdx !== SKULL_PRESET_INDEX) clearSkullPresetResidue();
  if (p === SKULL_PRESET_INDEX || ovIdx === SKULL_PRESET_INDEX) loadSkullParticleAsset();
  if (changed && prev === PHOENIX_PRESET_INDEX && p !== PHOENIX_PRESET_INDEX && ovIdx !== PHOENIX_PRESET_INDEX) clearPhoenixPresetResidue();
  if (p === PHOENIX_PRESET_INDEX || ovIdx === PHOENIX_PRESET_INDEX) loadPhoenixPresetAssets();
  if (changed && window.AuroradioSonicTopography) AuroradioSonicTopography.onPresetChange(prev, p, { scene: scene, fx: fx });
  if (changed && window.AuroradioSonicWorkshop) AuroradioSonicWorkshop.onPresetChange(prev, p, { scene: scene, fx: fx });
  uniforms.uPreset.value = fxMainParticlePreset();
  refreshPresetGrid();
  if (typeof updateSonicSeriesControlVisibility === 'function') updateSonicSeriesControlVisibility();
  if (typeof updateSonicWorkshopColorControls === 'function') updateSonicWorkshopColorControls();
  if (changed && !opts.skipTransition) triggerPresetParticleTransition(prev, p);
  // 每个预设对应的相机基线 (改 userOrbit)
  if (changed && !opts.preserveCamera) {
    if (p === 5) {
      captureCurrentOrbitAsBaseline();
      // 唱片预设跟随当前视角: 但该预设留有缩放记忆时仍恢复记忆值
      var rememberedZoom5 = (typeof fxZoomRememberFor === 'function') ? fxZoomRememberFor(p) : null;
      if (rememberedZoom5 != null && typeof orbit !== 'undefined' && orbit) {
        orbit.baselineRadius = rememberedZoom5;
        orbit.userRadius = rememberedZoom5;
      }
      requestStageLyricCameraSnap(12);
    } else if (typeof applyPresetOrbitBaseline === 'function') {
      applyPresetOrbitBaseline(p);
    }
  }
  if (changed && !opts.silent) showToast('视觉预设: ' + presetMeta[p].name);
  var shouldCommitPlaybackPreset = !!opts.commitPlaybackPreset || !opts.noSave;
  if (shouldCommitPlaybackPreset) {
    playbackVisualPreset = p;
    startupVisualPreviewActive = false;
  }
  if (!opts.noSave) {
    saveLyricLayout({ user: !opts.silent, reason: 'preset' });
  }
}

function syncFxUniforms() {
  // 叠加激活时全局已被 setFxPresetOverlay 切到叠加层参数上下文, 这里直接用全局
  uniforms.uPreset.value = fxMainParticlePreset();
  uniforms.uIntensity.value = fx.intensity;
  uniforms.uParticleCount.value = clampRange(Number(fx.particleCount) || 1, 0.1, 1);
  uniforms.uDepth.value = fx.depth;
  uniforms.uPointScale.value = fx.point;
  uniforms.uSpeed.value = fx.speed;
  uniforms.uTwist.value = fx.twist;
  uniforms.uColorBoost.value = fx.color;
  if (uniforms.uBright) uniforms.uBright.value = fxBrightnessFromSlider(fx.brightness);
  uniforms.uScatter.value = fx.scatter;
  uniforms.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
  uniforms.uBgFade.value = fx.bgFade;
  uniforms.uBloomStrength.value = fx.bloom ? fx.bloomStrength : 0;
  if (bloomParticles) bloomParticles.visible = fx.bloom && fx.bloomStrength > 0.01;
  uniforms.uEdgeEnabled.value = fx.edge ? 1 : 0;
  if (uniforms.uTintColor) uniforms.uTintColor.value.set(normalizeHexColor(fx.visualTintColor || '#9db8cf'));
  if (uniforms.uTintStrength) uniforms.uTintStrength.value = fx.visualTintMode === 'custom' ? 0.42 : 0;
  syncSkullParticleColors();
}

// ============ 分预设视觉参数 (统一调节开关) ============
// 统一调节开: 所有预设共享 fx 参数 (原行为); 关: 每个预设独立记忆 FX_SPLIT_KEYS 参数,
// 切换预设自动恢复该预设的值; 调整只在当前预设生效。
var FX_SPLIT_KEYS = [
  'intensity', 'cinemaShake', 'point', 'speed', 'twist', 'color', 'brightness', 'scatter', 'bgFade',
  'bloomStrength', 'particleCount', 'particleDensity', 'visualTintMode', 'visualTintColor',
  'phoenixColorMode', 'phoenixSolidColor', 'phoenixRhythmMode',
  // 景深/封面清晰度/视觉层开关
  'depth', 'coverResolution', 'floatLayer', 'bloom', 'edge', 'backgroundStarRiver',
  // 凤凰飞行轨迹参数 (动效面板凤凰专属滑杆/开关)
  // 注: presetOverlay 是结构字段 (由 setFxPresetOverlay/setPreset 管理), 不随参数快照应用/捕获
  'phoenixFlightPath', 'phoenixFlightDive', 'phoenixFlightShowPath',
  'phoenixFlightSpeed', 'phoenixFlightAmp', 'phoenixFlightSize', 'phoenixFlightTilt', 'phoenixFlightSpin',
  'phoenixPosX', 'phoenixPosY',
  // 歌词页参数 (显示/翻译、颜色光效、字体排版、歌词动画)
  // 注: 桌面歌词是独立系统层窗口, 保持全局, 不进分预设
  'lyricDisplayMode', 'lyricTranslationMode', 'lyricCustomLineCount',
  'lyricTranslationGap', 'lyricTranslationScale', 'lyricTranslationOpacity',
  'lyricColorMode', 'lyricColor', 'lyricHighlightMode', 'lyricHighlightColor',
  'lyricGlow', 'lyricGlowBeat', 'lyricGlowParticles', 'lyricGlowColor', 'lyricGlowLinked',
  'lyricGlowStrength', 'lyricBackgroundAdapt',
  'lyricTextureClarity', 'lyricFont', 'lyricLetterSpacing', 'lyricLineHeight', 'lyricWeight',
  'lyricScale', 'lyricOffsetX', 'lyricOffsetY', 'lyricOffsetZ', 'lyricTiltX', 'lyricTiltY', 'lyricKeepLevel',
  'lyricMotionStyle', 'lyricGlitchCameraBind', 'lyricGlitchIntensity', 'lyricGlitchSlice',
  'lyricGlitchChroma', 'lyricGlitchRate', 'lyricGlitchJitter',
  'lyricContextOpacity', 'lyricContextSpread', 'lyricEdgeFade', 'lyricMotionSoftness',
  'lyricVerticalFloat', 'lyricCameraLock', 'lyricPauseHold', 'lyricAvoidPhoenix'
];
var fxPerPresetStore = {};
var fxPerPresetLoaded = false;
var FX_PER_PRESET_STORE_KEY = 'mineradio-fx-per-preset-v2'; // v2: 扩充分预设键清单, 旧 v1 快照作废重新初始化
// 打包默认分预设快照: 与发布版全局默认值配套 (取自作者实机调优), 仅供无存档的全新会话初始化
var PACKAGED_FX_PER_PRESET_STORE = {"0":{"intensity":0.6,"cinemaShake":0,"point":0.87,"speed":0.4,"twist":0,"color":1.1,"brightness":1.05,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":0.95,"particleDensity":1.7,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":true,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":0.6,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.61,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"1":{"intensity":0.6,"cinemaShake":0,"point":0.73,"speed":0.55,"twist":0,"color":1.1,"brightness":4.1,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":0.8,"particleDensity":2.8,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"2":{"intensity":0.6,"cinemaShake":0,"point":0.5,"speed":0.55,"twist":0,"color":1.1,"brightness":1.85,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":0.72,"particleDensity":1.95,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"3":{"intensity":0.6,"cinemaShake":0,"point":1.82,"speed":0.55,"twist":0,"color":1.1,"brightness":1.85,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":4,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"4":{"intensity":0.6,"cinemaShake":0,"point":0.57,"speed":0.55,"twist":0,"color":1.1,"brightness":2,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":0.75,"particleDensity":2.5,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"5":{"intensity":0.6,"cinemaShake":0,"point":0.79,"speed":0.37,"twist":0,"color":1.1,"brightness":10,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":1.85,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"6":{"intensity":0.6,"cinemaShake":0,"point":0.65,"speed":0.55,"twist":0,"color":1.1,"brightness":1.65,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":2.55,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.61,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"7":{"intensity":0.6,"cinemaShake":0,"point":0.6,"speed":0.55,"twist":0,"color":1.1,"brightness":1.65,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":4,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":2.73,"lyricOffsetY":0.75,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"8":{"intensity":0.6,"cinemaShake":0,"point":1.82,"speed":0.55,"twist":0,"color":1.1,"brightness":1.65,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":4,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":true,"phoenixFlightPath":"circle","phoenixFlightDive":true,"phoenixFlightShowPath":true,"phoenixFlightSpeed":2,"phoenixFlightAmp":0.65,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":0,"lyricOffsetY":0,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false},"9":{"intensity":0.6,"cinemaShake":0,"point":1.67,"speed":0.6,"twist":0,"color":1.1,"brightness":4,"scatter":0,"bgFade":0,"bloomStrength":0,"particleCount":1,"particleDensity":3.35,"visualTintMode":"auto","visualTintColor":"#9db8cf","phoenixColorMode":"cover","phoenixSolidColor":"#ffffff","phoenixRhythmMode":"sweep","depth":0.2,"coverResolution":1.55,"floatLayer":false,"bloom":false,"edge":false,"backgroundStarRiver":false,"phoenixFlightPath":"none","phoenixFlightDive":true,"phoenixFlightShowPath":false,"phoenixFlightSpeed":0.3,"phoenixFlightAmp":1.25,"phoenixFlightSize":1.8,"phoenixFlightTilt":26,"phoenixFlightSpin":21,"phoenixPosX":-3.67,"phoenixPosY":1.07,"lyricDisplayMode":"cinema","lyricTranslationMode":"multi","lyricCustomLineCount":10,"lyricTranslationGap":0.92,"lyricTranslationScale":0.65,"lyricTranslationOpacity":0.86,"lyricColorMode":"auto","lyricColor":"#6d1f35","lyricHighlightMode":"auto","lyricHighlightColor":"#fff0b8","lyricGlow":true,"lyricGlowBeat":true,"lyricGlowParticles":false,"lyricGlowColor":"#9db8cf","lyricGlowLinked":true,"lyricGlowStrength":0,"lyricBackgroundAdapt":0.72,"lyricTextureClarity":4,"lyricFont":"stone-song","lyricLetterSpacing":0,"lyricLineHeight":1,"lyricWeight":750,"lyricScale":0.7,"lyricOffsetX":2.73,"lyricOffsetY":0.75,"lyricOffsetZ":0,"lyricTiltX":0,"lyricTiltY":0,"lyricKeepLevel":true,"lyricMotionStyle":"shine","lyricGlitchCameraBind":true,"lyricGlitchIntensity":1,"lyricGlitchSlice":0.72,"lyricGlitchChroma":0.86,"lyricGlitchRate":1,"lyricGlitchJitter":0.72,"lyricContextOpacity":0.54,"lyricContextSpread":1.96,"lyricEdgeFade":0.32,"lyricMotionSoftness":0.72,"lyricVerticalFloat":false,"lyricCameraLock":false,"lyricPauseHold":true,"lyricAvoidPhoenix":false}};

function fxPerPresetLoad() {
  if (fxPerPresetLoaded) return;
  fxPerPresetLoaded = true;
  try {
    var raw = localStorage.getItem(FX_PER_PRESET_STORE_KEY);
    if (raw) fxPerPresetStore = JSON.parse(raw) || {};
  } catch (err) { fxPerPresetStore = {}; }
  if (!Object.keys(fxPerPresetStore).length && typeof PACKAGED_FX_PER_PRESET_STORE !== 'undefined') {
    try { fxPerPresetStore = JSON.parse(JSON.stringify(PACKAGED_FX_PER_PRESET_STORE)); } catch (err) { fxPerPresetStore = {}; }
  }
}
function fxPerPresetSave() {
  try { localStorage.setItem(FX_PER_PRESET_STORE_KEY, JSON.stringify(fxPerPresetStore)); } catch (err) {}
}
function fxCaptureSplitSnapshot() {
  var snap = {};
  for (var i = 0; i < FX_SPLIT_KEYS.length; i++) {
    var k = FX_SPLIT_KEYS[i];
    if (fx[k] !== undefined) snap[k] = fx[k];
  }
  return snap;
}
function fxApplySplitSnapshot(snap) {
  if (!snap) return;
  var patched = false;
  var lyricChanged = false;
  for (var i = 0; i < FX_SPLIT_KEYS.length; i++) {
    var k = FX_SPLIT_KEYS[i];
    if (snap[k] !== undefined) {
      if (fx[k] !== undefined) {
        if (fx[k] !== snap[k]) {
          fx[k] = snap[k];
          if (k.indexOf('lyric') === 0) lyricChanged = true;
        }
      }
    } else if (fx[k] !== undefined) {
      // 旧快照缺后来新增的键: 以当前值固化进该预设快照, 防止跨预设漂移/重启后参数跳变
      snap[k] = fx[k];
      patched = true;
    }
  }
  if (patched && typeof fxPerPresetSave === 'function') fxPerPresetSave();
  if (typeof syncFxUniforms === 'function') syncFxUniforms();
  if (typeof updateFxInputs === 'function') { try { updateFxInputs(); } catch (err) {} }
  if (typeof syncSkullParticleColors === 'function') syncSkullParticleColors();
  if (typeof syncPhoenixParticleColors === 'function') syncPhoenixParticleColors();
  // 歌词参数随预设恢复: 调色板/字体排版/纹理清晰度需要重新应用
  if (lyricChanged) {
    if (typeof applySavedLyricPaletteState === 'function') applySavedLyricPaletteState();
    if (typeof refreshCurrentLyricStyle === 'function') refreshCurrentLyricStyle();
    if (typeof invalidateLyricQualityTextures === 'function') {
      var clarityRelease = true;
      if (typeof normalizeLyricTextureClarity === 'function') clarityRelease = normalizeLyricTextureClarity(fx.lyricTextureClarity) <= 1;
      invalidateLyricQualityTextures('per-preset-lyric-restore', { release: clarityRelease });
    }
  }
  // 浮空粒子层开关随预设恢复
  if (fx.floatLayer) { if (typeof createFloatLayer === 'function') createFloatLayer(); }
  else if (typeof destroyFloatLayer === 'function') destroyFloatLayer();
}
function fxCaptureForSplitIfOn() {
  if (!fx || fx.perPresetSplit !== true) return;
  fxPerPresetLoad();
  // 叠加激活时全局是叠加层的参数上下文 → 捕获归叠加层预设 (主层冻结在自己的快照)
  var ov = getFxPresetOverlay();
  var p = ov >= 0 ? ov : clampRange(Number(fx.preset) || 0, 0, presetMeta.length - 1);
  var snap = fxCaptureSplitSnapshot();
  var old = fxPerPresetStore[p] ? JSON.stringify(fxPerPresetStore[p]) : '';
  var now = JSON.stringify(snap);
  if (old !== now) { fxPerPresetStore[p] = snap; fxPerPresetSave(); }
}
function toggleFxPerPresetSplit() {
  fx.perPresetSplit = fx.perPresetSplit !== true;
  fxPerPresetLoad();
  if (fx.perPresetSplit) {
    // 进入分预设模式: 当前共享值作为每个预设的初始快照
    var cur = fxCaptureSplitSnapshot();
    presetMeta.forEach(function (_, idx) {
      if (!fxPerPresetStore[idx]) fxPerPresetStore[idx] = JSON.parse(JSON.stringify(cur));
    });
    fxPerPresetStore[Number(fx.preset) || 0] = cur;
    fxPerPresetSave();
  }
  updateFxPerPresetToggleUI();
  if (typeof showToast === 'function') showToast(fx.perPresetSplit ? '分预设调节: 各预设参数独立' : '统一调节: 所有预设共享');
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'fxPerPresetSplit' });
}
function updateFxPerPresetToggleUI() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  // 控制台工作台会把 preset-grid 搬进分区并清理原容器 — 动态确保按钮行存在并跟随网格落位
  var row = document.getElementById('fx-perpreset-row');
  if (!row) {
    row = document.createElement('div');
    row.id = 'fx-perpreset-row';
    row.className = 'fx-perpreset-row';
    row.innerHTML = '<button class="fx-mini-btn ghost" id="fx-perpreset-toggle" type="button"' +
      ' onclick="toggleFxPerPresetSplit()">统一调节：开</button>' +
      '<span class="fx-perpreset-hint" id="fx-perpreset-hint">所有预设共享同一套参数</span>';
  }
  if (row.previousElementSibling !== grid || row.parentNode !== grid.parentNode) {
    grid.parentNode.insertBefore(row, grid.nextSibling);
  }
  var el = document.getElementById('fx-perpreset-toggle');
  if (!el) return;
  var split = fx && fx.perPresetSplit === true;
  el.textContent = split ? '统一调节：关' : '统一调节：开';
  el.title = split ? '各预设独立记忆参数，切换预设自动恢复' : '所有预设共享同一套参数';
  el.classList.toggle('on', split);
  var hint = document.getElementById('fx-perpreset-hint');
  if (hint) hint.textContent = split ? '调整只影响当前预设，切换自动恢复' : '所有预设共享同一套参数';
}
if (typeof fx !== 'undefined' && fx && fx.perPresetSplit === true) {
  // 启动时处于分预设模式: 恢复当前预设的参数
  fxPerPresetLoad();
  var __sp = clampRange(Number(fx.preset) || 0, 0, presetMeta.length - 1);
  if (fxPerPresetStore[__sp]) fxApplySplitSnapshot(fxPerPresetStore[__sp]);
  // 叠加仍激活: 全局切到叠加层参数上下文
  var __ov = getFxPresetOverlay();
  if (__ov >= 0 && __ov !== __sp) {
    if (!fxPerPresetStore[__ov]) fxPerPresetStore[__ov] = fxCaptureSplitSnapshot();
    fxApplySplitSnapshot(fxPerPresetStore[__ov]);
  }
}
// 控制台工作台启动较晚且会搬运 DOM — 延时数次确保按钮行挂到预设网格旁
[400, 1500, 3500, 7000].forEach(function (ms) {
  setTimeout(function () { try { updateFxPerPresetToggleUI(); } catch (err) {} }, ms);
});

// ============ 预设叠加层 (在当前预设之上再显示一层独立视觉) ============
// 候选: 5=星河(粒子) 6=安魂 7=音域回响 9=凤凰; 主预设与叠加层相同则视为无
var FX_OVERLAY_CANDIDATES = [5, 6, 7, 9];
// 预设叠加功能已停用 (2026-09-17): UI 入口移除 + 状态强制无叠加; 置 false 可整体恢复
var FX_OVERLAY_DISABLED = true;
function setFxPresetOverlay(idx) {
  idx = Math.round(Number(idx));
  if (!isFinite(idx) || idx < -1 || idx > 9 || (idx >= 0 && !presetMeta[idx])) idx = -1;
  if (FX_OVERLAY_DISABLED) idx = -1;
  if (idx === (Number(fx.preset) || 0)) idx = -1;
  if (getFxPresetOverlay() === idx) {
    if (typeof updateFxPresetOverlayUI === 'function') updateFxPresetOverlayUI();
    return;
  }
  if (fx.perPresetSplit === true) {
    // 叠加 = 参数上下文切换: 先把当前全局值存回"即将离开的上下文" (旧叠加层/主预设),
    // 再切全局到新上下文的快照 —— 开/关叠加绝不写坏任何预设的参数
    if (typeof fxCaptureForSplitIfOn === 'function') fxCaptureForSplitIfOn();
    fx.presetOverlay = idx;
    fxPerPresetLoad();
    var ctxIdx = idx >= 0 ? idx : (Number(fx.preset) || 0);
    if (!fxPerPresetStore[ctxIdx]) fxPerPresetStore[ctxIdx] = fxCaptureSplitSnapshot();
    fxApplySplitSnapshot(fxPerPresetStore[ctxIdx]);
    if (typeof updateFxInputs === 'function') updateFxInputs();
  } else {
    fx.presetOverlay = idx;
    if (typeof syncFxUniforms === 'function') syncFxUniforms();
  }
  if (idx === PHOENIX_PRESET_INDEX && typeof loadPhoenixPresetAssets === 'function') loadPhoenixPresetAssets();
  if (idx === SKULL_PRESET_INDEX && typeof loadSkullParticleAsset === 'function') loadSkullParticleAsset();
  if (typeof updateFxPresetOverlayUI === 'function') updateFxPresetOverlayUI();
  if (typeof showToast === 'function') showToast(idx < 0 ? '预设叠加: 无' : '预设叠加: ' + presetMeta[idx].name);
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'presetOverlay' });
}
function updateFxPresetOverlayUI() {
  if (FX_OVERLAY_DISABLED) {
    var deadRow = document.getElementById('fx-overlay-row');
    if (deadRow && deadRow.parentNode) deadRow.parentNode.removeChild(deadRow);
    return;
  }
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var row = document.getElementById('fx-overlay-row');
  if (!row) {
    row = document.createElement('div');
    row.id = 'fx-overlay-row';
    row.className = 'fx-perpreset-row';
    var html = '<span class="fx-perpreset-hint" id="fx-overlay-hint">叠加: 无</span>';
    FX_OVERLAY_CANDIDATES.forEach(function (idx) {
      var label = presetMeta[idx] ? presetMeta[idx].name : String(idx);
      html += '<button class="fx-mini-btn ghost" type="button" data-ov="' + idx + '"' +
        ' onclick="setFxPresetOverlay(' + idx + ')" title="在当前预设上叠加显示 ' + label + '">' + label + '</button>';
    });
    html += '<button class="fx-mini-btn ghost" type="button" data-ov="-1" onclick="setFxPresetOverlay(-1)" title="取消叠加">无</button>';
    row.innerHTML = html;
  }
  // 控制台工作台会搬运 preset-grid — 跟随锚定 (统一调节行之下)
  var anchor = document.getElementById('fx-perpreset-row');
  if (!anchor || anchor.parentNode !== grid.parentNode) anchor = grid;
  if (row.previousElementSibling !== anchor || row.parentNode !== anchor.parentNode) {
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
  }
  var ov = getFxPresetOverlay();
  var btns = row.querySelectorAll('button[data-ov]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('on', Number(btns[i].getAttribute('data-ov')) === ov);
  }
  var hint = document.getElementById('fx-overlay-hint');
  if (hint) hint.textContent = ov < 0 ? '叠加: 无' : '叠加: ' + (presetMeta[ov] ? presetMeta[ov].name : ov);
}
[400, 1500, 3500, 7000].forEach(function (ms) {
  setTimeout(function () { try { updateFxPresetOverlayUI(); } catch (err) {} }, ms);
});
