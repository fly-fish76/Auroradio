// ============================================================
//  凤凰 — 蒙皮粒子建模层 (预设 9)
//   - phoenix-points.bin: 46000 表面采样点, 16 float/点
//     [x,y,z | kind | seed | j0..j3 | w0..w3 | r,g,b(linear)]
//   - phoenix-rig.json: 89 关节 bindLocal TRS + parent + 链分组
//   - GPU 蒙皮: 关节矩阵 (N * nodeWorld * IBM) 写入 DataTexture
//   - 程序化骨骼驱动: 翅膀节拍扇动 / 尾羽摆动 / 冠羽飘动 / 下颌鸣叫
// ============================================================
var PHOENIX_PRESET_INDEX = 9;
var PHOENIX_MODEL_SCALE = 1.35;          // bin 已归一化(高≈2.2), 运行时二次缩放
var PHOENIX_MODEL_BASE_POSITION = { x: 0, y: 1.35, z: 0.10 };
var PHOENIX_MODEL_BASE_ROTATION_Y = Math.PI + 0.55; // 3/4 视角
var PHOENIX_MODEL_BASE_ROTATION_X = -0.10;
// ---- 飞行轨迹 (可叠加): 横向路径 盘旋椭圆/左右巡游 二选一 + 俯冲独立开关 ----
var PHOENIX_FLIGHT_FORWARD_YAW = 1.553; // 模型 rotY=0 时朝 +x (点云头尾质心连线实测, ≈π/2): 面向yaw = rotY + 此值
var PHOENIX_FLIGHT_PATROL_RATE = 0.55;
var PHOENIX_FLIGHT_DIVE_RATE = 1.0;
// 盘旋椭圆: 半轴 a(横向)/b(纵深), speed=线速度(世界单位/秒, 弧长匀速)
var PHOENIX_FLIGHT_ELLIPSE = { a: 6.0, b: 2.6, speed: 2.2 };
// 轨迹幅度随相机距离自适应缩放 (半径 8.4 为基准, 近景缩小防出画, 远景放大) × 用户幅度滑杆
var phoenixFlightScale = 1;
var phoenixFlight = { phase: 0, divePhase: 0, offX: 0, offY: 0, offZ: 0, yaw: PHOENIX_MODEL_BASE_ROTATION_Y + PHOENIX_FLIGHT_FORWARD_YAW, bank: 0, pitch: 0 };
var phoenixFlightLine = null;                   // 轨迹虚线 (THREE.Line + LineDashedMaterial)
var phoenixAmpPulse = 0;
var phoenixBeatFlash = 0;
var phoenixFlapPhase = 0;
var phoenixBreath = { v: 1, target: 4, hold: 0 };  // 呼吸律动: 亮度随机漂移状态
var phoenixSweepPhase = 0;                          // 线光扫描相位 0..1.22
var phoenixOpacity = 0;
var phoenixParticleGroup = null;
var phoenixAsset = { bin: null, rig: null, promise: null, failed: false };
var phoenixAnimData = null;              // 原版飞行动画 (100帧 × 关节 × TRS10)
var phoenixAnimTime = 0;
var phoenixJointTexture = null;
var phoenixJointData = null;             // Float32Array jointCount*4*4
var phoenixBindQ = null;                 // 每关节 bind 旋转
var phoenixLocalT = null, phoenixLocalS = null;
var phoenixLocalM = null, phoenixWorldM = null, phoenixAncM = null;
var phoenixAnimMats = null;              // 每关节 THREE.Matrix4 (N*world*IBM)
var phoenixDeltaQ = null;                // 每关节程序化 ΔR (Quaternion)
var phoenixScratch = null;
var phoenixTintScratch = { base: null, glow: null, shadow: null, light: null };
var phoenixDefaultColors = null;   // 烘焙原始逐点颜色 (封面模式换色/切回默认时恢复用)
var phoenixCoverRemapSig = '';     // 当前封面梯度签名 (避免每帧重算)

function effectivePhoenixVisualTint() {
  // 凤凰配色模式: default=固定火羽色 / solid=用户纯色 / cover=封面取色
  var mode = fx && fx.phoenixColorMode === 'solid' ? 'solid' : (fx && fx.phoenixColorMode === 'cover' ? 'cover' : 'default');
  if (mode === 'solid') {
    return { color: normalizeHexColor(fx.phoenixSolidColor || '#ff8a3c', '#ff8a3c'), strength: 0, solid: true };
  }
  if (mode === 'cover') {
    var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
    var cAny = phoenixParseColorAny(pal.secondary || pal.primary || (fxDefaults && fxDefaults.visualTintColor));
    return { color: cAny || '#ff8a3c', strength: 0.24, solid: false };
  }
  return { color: '#ff8a3c', strength: 0, solid: false };
}

function syncPhoenixParticleColors() {
  if (!phoenixParticleGroup || !phoenixParticleGroup.material || !phoenixParticleGroup.material.uniforms) return;
  var u = phoenixParticleGroup.material.uniforms;
  var tint = effectivePhoenixVisualTint();
  if (!phoenixTintScratch.base) {
    phoenixTintScratch.base = new THREE.Color();
    phoenixTintScratch.glow = new THREE.Color();
    phoenixTintScratch.shadow = new THREE.Color();
    phoenixTintScratch.light = new THREE.Color();
  }
  var s = clampRange(tint.strength, 0, 0.95);
  phoenixTintScratch.glow.set(tint.color);
  // 辉光色防发白: 封面取色可能过浅, 亮度钳到 0.60 以下、饱和度保底 0.55 (纯色模式尊重用户选择, 不钳)
  if (!tint.solid) {
    if (!phoenixTintScratch.hsl) phoenixTintScratch.hsl = { h: 0, s: 0, l: 0 };
    phoenixTintScratch.glow.getHSL(phoenixTintScratch.hsl);
    phoenixTintScratch.glow.setHSL(phoenixTintScratch.hsl.h, Math.max(phoenixTintScratch.hsl.s, 0.55), Math.min(phoenixTintScratch.hsl.l, 0.60));
  }
  phoenixTintScratch.shadow.copy(phoenixTintScratch.glow).lerp(new THREE.Color('#0a0406'), 0.86);
  phoenixTintScratch.light.copy(phoenixTintScratch.glow).lerp(new THREE.Color('#fff3c0'), 0.72);
  phoenixTintScratch.base.set('#ffffff').lerp(phoenixTintScratch.glow, s * 0.22);
  if (u.uTint) u.uTint.value.copy(phoenixTintScratch.base);
  if (u.uGlow) u.uGlow.value.copy(phoenixTintScratch.glow);
  if (u.uShadow) u.uShadow.value.copy(phoenixTintScratch.shadow);
  if (u.uLight) u.uLight.value.copy(phoenixTintScratch.light);
  if (u.uSolidColor) u.uSolidColor.value.copy(phoenixTintScratch.glow);
  if (u.uSolidAmt) u.uSolidAmt.value = tint.solid ? 1 : 0;
  phoenixApplyRegionColors();
}

// ---- 封面模式: 按"默认配色各区域的明度"用封面颜色梯度整组替换逐点颜色 ----
function phoenixLuma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

// 封面调色板字段是 'rgb(r,g,b)' 格式 (rgbCss 产物), 兼容 hex; 解析失败返回 null
function phoenixParseColorAny(value) {
  var v = String(value || '').trim();
  if (!v) return null;
  try {
    var c = new THREE.Color(v);
    if (!isFinite(c.r) || !isFinite(c.g) || !isFinite(c.b)) return null;
    return c;
  } catch (e) {
    var hex = normalizeHexColor(v, '');
    return hex ? new THREE.Color(hex) : null;
  }
}

// 从封面调色板收集梯度锚点 (暗→亮排序, 首尾锚定 0/1)
function phoenixCollectCoverStops() {
  var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || null;
  if (!pal) return null;
  var names = ['rawDark', 'secondary', 'primary', 'rawWarm', 'rawCool', 'rawAccent', 'highlight', 'rawLight'];
  var stops = [];
  var seen = {};
  names.forEach(function (name) {
    var c = phoenixParseColorAny(pal[name]);
    if (!c) return;
    var key = Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255);
    if (seen[key]) return;
    seen[key] = 1;
    stops.push({ l: clampRange(phoenixLuma(c.r, c.g, c.b), 0, 1), r: c.r, g: c.g, b: c.b });
  });
  if (stops.length < 2) return null;
  stops.sort(function (a, b) { return a.l - b.l; });
  if (stops[0].l > 0.02) stops.unshift({ l: 0, r: stops[0].r, g: stops[0].g, b: stops[0].b });
  var last = stops[stops.length - 1];
  if (last.l < 0.98) stops.push({ l: 1, r: last.r, g: last.g, b: last.b });
  return stops;
}

function phoenixSampleStops(stops, l) {
  for (var i = 1; i < stops.length; i++) {
    if (l <= stops[i].l || i === stops.length - 1) {
      var a = stops[i - 1], b = stops[i];
      var span = b.l - a.l;
      var t = span > 0.0001 ? clampRange((l - a.l) / span, 0, 1) : 1;
      return [a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t];
    }
  }
  var p = stops[stops.length - 1];
  return [p.r, p.g, p.b];
}

function phoenixApplyRegionColors() {
  if (!phoenixParticleGroup || !phoenixDefaultColors) return;
  var attr = phoenixParticleGroup.geometry && phoenixParticleGroup.geometry.attributes.aColor;
  if (!attr || !attr.array) return;
  var arr = attr.array;
  if (phoenixColorModeId() !== 'cover') {
    if (phoenixCoverRemapSig !== '') { // 离开封面模式: 恢复烘焙原色
      arr.set(phoenixDefaultColors);
      attr.needsUpdate = true;
      phoenixCoverRemapSig = '';
    }
    return;
  }
  var stops = phoenixCollectCoverStops();
  var sig = stops
    ? stops.map(function (s) { return s.l.toFixed(3) + '|' + s.r.toFixed(3) + ',' + s.g.toFixed(3) + ',' + s.b.toFixed(3); }).join(';')
    : 'none';
  if (sig === phoenixCoverRemapSig) return;
  phoenixCoverRemapSig = sig;
  if (!stops) {
    arr.set(phoenixDefaultColors);
  } else {
    for (var i = 0; i < arr.length; i += 3) {
      var l = phoenixLuma(phoenixDefaultColors[i], phoenixDefaultColors[i + 1], phoenixDefaultColors[i + 2]);
      var rgb = phoenixSampleStops(stops, l);
      arr[i] = rgb[0]; arr[i + 1] = rgb[1]; arr[i + 2] = rgb[2];
    }
  }
  attr.needsUpdate = true;
}

function loadPhoenixPresetAssets() {
  if (phoenixAsset.bin && phoenixAsset.rig) return Promise.resolve(true);
  if (phoenixAsset.promise) return phoenixAsset.promise;
  if (typeof fetch !== 'function') { phoenixAsset.failed = true; return Promise.resolve(false); }
  phoenixAsset.promise = Promise.all([
    fetch('assets/phoenix-points.bin?v=phoenix-v4').then(function (res) {
      if (!res.ok) throw new Error('phoenix bin ' + res.status);
      return res.arrayBuffer();
    }),
    fetch('assets/phoenix-rig.json?v=phoenix-v4').then(function (res) {
      if (!res.ok) throw new Error('phoenix rig ' + res.status);
      return res.json();
    }),
    fetch('assets/phoenix-anim.bin?v=phoenix-v4').then(function (res) {
      return res.ok ? res.arrayBuffer() : null;
    }).catch(function () { return null; })
  ]).then(function (rs) {
    phoenixAsset.bin = new Float32Array(rs[0]);
    phoenixAsset.rig = rs[1];
    phoenixAnimData = rs[2] ? new Float32Array(rs[2]) : null;
    phoenixAsset.promise = null;
    return true;
  }).catch(function (err) {
    console.warn('phoenix preset assets load failed:', err);
    phoenixAsset.failed = true;
    phoenixAsset.promise = null;
    return false;
  });
  return phoenixAsset.promise;
}

// ---- 骨骼工具 ----
function phoenixComposeQuat(parentQ, localQ, out) {
  out.copy(parentQ).multiply(localQ);
  return out;
}
function phoenixApplyQuatToVec(q, v, out) {
  // out = q * v
  var x = v.x, y = v.y, z = v.z;
  var qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  var ix = qw * x + qy * z - qz * y;
  var iy = qw * y + qz * x - qx * z;
  var iz = qw * z + qx * y - qy * x;
  var iw = -qx * x - qy * y - qz * z;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}
function phoenixQuatFromAxisAngle(axis, angle, out) {
  out.setFromAxisAngle(axis, angle);
  return out;
}

function createPhoenixParticleLayer() {
  if (phoenixParticleGroup) return phoenixParticleGroup;
  var asset = phoenixAsset.bin;
  var rig = phoenixAsset.rig;
  if (!asset || !rig) return null;
  var count = Math.floor(asset.length / 16);
  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(count * 3);
  var kinds = new Float32Array(count);
  var seeds = new Float32Array(count);
  var joints = new Float32Array(count * 4);
  var weights = new Float32Array(count * 4);
  var colors = new Float32Array(count * 3);
  for (var i = 0; i < count; i++) {
    var o = i * 16, g = i * 3;
    positions[g] = asset[o]; positions[g + 1] = asset[o + 1]; positions[g + 2] = asset[o + 2];
    kinds[i] = asset[o + 3];
    seeds[i] = asset[o + 4];
    joints[i * 4] = asset[o + 5]; joints[i * 4 + 1] = asset[o + 6];
    joints[i * 4 + 2] = asset[o + 7]; joints[i * 4 + 3] = asset[o + 8];
    weights[i * 4] = asset[o + 9]; weights[i * 4 + 1] = asset[o + 10];
    weights[i * 4 + 2] = asset[o + 11]; weights[i * 4 + 3] = asset[o + 12];
    colors[g] = asset[o + 13]; colors[g + 1] = asset[o + 14]; colors[g + 2] = asset[o + 15];
  }
  phoenixDefaultColors = colors.slice(); // 封面模式调色板映射的还原基准
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aJoint', new THREE.BufferAttribute(joints, 4));
  geo.setAttribute('aWeight', new THREE.BufferAttribute(weights, 4));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  var jointCount = rig.jointCount;
  phoenixJointData = new Float32Array(jointCount * 4 * 4);
  phoenixJointTexture = new THREE.DataTexture(phoenixJointData, jointCount, 4, THREE.RGBAFormat, THREE.FloatType);
  phoenixJointTexture.minFilter = THREE.NearestFilter;
  phoenixJointTexture.magFilter = THREE.NearestFilter;
  phoenixJointTexture.needsUpdate = true;

  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture },
      uTime: uniforms.uTime,
      uPixel: uniforms.uPixel,
      uPointScale: uniforms.uPointScale,
      uBloomStrength: uniforms.uBloomStrength,
      uColorBoost: uniforms.uColorBoost,
      uBass: uniforms.uBass,
      uMid: uniforms.uMid,
      uTreble: uniforms.uTreble,
      uBeat: uniforms.uBeat,
      uJointTex: { value: phoenixJointTexture },
      uJointCount: { value: jointCount },
      uParticleCount: { value: 1.0 },
      uSpeed: { value: 1.0 },
      uDensityBoost: { value: 1.0 },
      uOpacity: { value: 0 },
      uFlash: { value: 0 },
      uWingGlow: { value: 0 },
      uTint: { value: new THREE.Color('#ffffff') },
      uGlow: { value: new THREE.Color('#ff8a3c') },
      uSolidColor: { value: new THREE.Color('#ff8a3c') },
      uSolidAmt: { value: 0 },
      uShadow: { value: new THREE.Color('#140508') },
      uLight: { value: new THREE.Color('#ffd9a0') },
      uPhoenixBright: { value: 1.0 },   // 律动模式: 生效亮度 (呼吸模式由 JS 随机驱动, 其余=滑杆值)
      uBeatBright: { value: 0 },        // 鼓点增亮量 0..1 (默认律动模式)
      uSweepPos: { value: 0 },          // 线光位置 0=头 1=尾
      uSweepOn: { value: 0 }            // 线光模式开关
    },
    vertexShader: [
      'precision highp float;',
      'attribute float aKind,aSeed;',
      'attribute vec4 aJoint,aWeight;',
      'attribute vec3 aColor;',
      'uniform sampler2D uJointTex;',
      'uniform float uJointCount,uTime,uPixel,uPointScale,uBloomStrength,uColorBoost;',
      'uniform float uParticleCount,uSpeed,uDensityBoost;',
      'uniform float uBass,uMid,uTreble,uBeat,uFlash,uWingGlow,uSolidAmt,uSweepPos,uSweepOn;',
      'uniform vec3 uGlow,uSolidColor;',
      'varying vec3 vCol;',
      'varying float vLight,vRim,vKind,vFlash,vAmp,vSweep;',
      'mat4 jointMat(float j){',
      '  float x=(j+0.5)/uJointCount;',
      '  vec4 r0=texture2D(uJointTex,vec2(x,0.125));',
      '  vec4 r1=texture2D(uJointTex,vec2(x,0.375));',
      '  vec4 r2=texture2D(uJointTex,vec2(x,0.625));',
      '  vec4 r3=texture2D(uJointTex,vec2(x,0.875));',
      '  return mat4(r0,r1,r2,r3);',
      '}',
      'void main(){',
      '  vKind=aKind;',
      '  mat4 skin=',
      '    aWeight.x*jointMat(aJoint.x)+',
      '    aWeight.y*jointMat(aJoint.y)+',
      '    aWeight.z*jointMat(aJoint.z)+',
      '    aWeight.w*jointMat(aJoint.w);',
      '  vec3 pos=(skin*vec4(position,1.0)).xyz;',
      // 微噪声: 羽毛颗粒感 (蒙皮后归一化空间)
      '  float featherNoise=fract(sin(aSeed*13.731+aKind*17.17)*43758.5453);',
      '  pos+=normalize(vec3(sin(aSeed),cos(aSeed*0.7),sin(aSeed*1.3)))*featherNoise*0.012;',
      '  vFlash=uFlash;',
      '  vAmp=clamp(uBeat*0.42+uBass*0.14,0.0,1.0);',
      '  vec4 mv=modelViewMatrix*vec4(pos,1.0);',
      '  float dist=max(0.55,-mv.z);',
      // 伪法线光照 (蒙皮后位置)
      '  vec3 n=normalize(vec3(pos.x*0.72,pos.y*0.55,pos.z*0.88+0.10));',
      '  vec3 vn=normalize(normalMatrix*n);',
      '  vec3 keyDir=normalize(vec3(-0.42,0.66,0.62));',
      '  vec3 rimDir=normalize(vec3(0.86,0.16,-0.46));',
      '  float key=pow(max(dot(vn,keyDir),0.0),1.25);',
      '  vRim=pow(max(dot(vn,rimDir),0.0),2.6)*(0.30+uBloomStrength*0.10);',
      '  float lit=clamp(0.20+key*1.05+vRim*0.24+vAmp*0.34,0.05,1.60);',
      '  vLight=lit;',
      // 线光: 模型局部 x (头=+x) 0→1 扫描带, 高斯亮带
      '  float bx=clamp((pos.x+1.1)/2.2,0.0,1.0);',
      '  float sd=bx-(1.0-uSweepPos);',
      '  vSweep=exp(-sd*sd*78.0)*uSweepOn;',
      // 翅尖/尾羽火焰辉光
      '  float glowKind=step(0.31,aKind)*step(aKind,0.33)*1.0+step(0.49,aKind)*step(aKind,0.51)*1.0;', // 尾羽与翅尖辉光同权重 (上下配色一致)
      '  float flicker=0.62+0.38*sin(uTime*(2.1+aSeed*0.004)+aSeed);',
      '  vCol=mix(aColor*clamp(uColorBoost,0.5,2.0),uSolidColor,uSolidAmt);', // 纯色模式: 通体覆盖为用户色
      '  vCol+=uGlow*glowKind*flicker*(0.16+uWingGlow*0.30);',
      '  float size=(0.042+step(0.31,aKind)*0.008)*(1.00+lit*0.30)*uDensityBoost;',
      '  gl_PointSize=clamp(size*uPixel*clamp(uPointScale,0.48,2.35)*128.0/dist,1.30,7.80);',
      '  gl_Position=projectionMatrix*mv;',
      // 粒子数量裁剪: seed 随机均匀, 超出保留比例的点移出裁剪空间
      '  if (fract(aSeed*0.1731) > uParticleCount) { gl_PointSize=0.0; gl_Position=vec4(2.0,2.0,2.0,1.0); }',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uTint,uGlow,uShadow,uLight;',
      'uniform float uOpacity,uBloomStrength,uPhoenixBright,uBeatBright,uSweepOn;',
      'varying vec3 vCol;',
      'varying float vLight,vRim,vKind,vFlash,vAmp,vSweep;',
      'void main(){',
      '  vec4 tex=texture2D(uMap,gl_PointCoord);',
      '  if(tex.a<0.07) discard;',
      '  float lit=clamp(pow(vLight,mix(1.18,0.80,0.35)),0.0,1.35);',
      '  vec3 col=vCol*uTint;',
      '  col=mix(uShadow,col,clamp(lit,0.0,1.0));', // 暗部→本色
      '  col*=(1.00+0.80*clamp(lit,0.0,1.0));',    // 亮部增益
      '  col=mix(col,uLight,clamp(lit*lit*0.55+vRim*0.40,0.0,0.78));', // 亮面提亮到火羽色
      '  col+=uGlow*vAmp*0.08;',
      '  col*=clamp(uPhoenixBright,0.0,20.0);',    // 生效亮度 (律动模式驱动)
      '  col*=(1.00+uBeatBright*0.55);',           // 鼓点增亮: 平滑提亮, 无闪跳
      '  col*=mix(0.58,1.90,vSweep);',             // 线光对比: 光带内提亮 1.9x, 带外压暗 0.58x
      '  col=mix(col,uLight,clamp(vSweep*0.30,0.0,0.30));', // 线光经过: 轻微提色
      '  float mBright=max(col.r,max(col.g,col.b));',
      '  if (mBright>1.0) col/=mBright;',          // 色相保持: 越界按最大通道等比缩回, 不削成白色
      '  float alpha=tex.a*uOpacity*clamp(0.34+lit*0.55+vRim*0.12,0.16,1.5);',
      '  gl_FragColor=vec4(col,alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });
  phoenixParticleGroup = new THREE.Points(geo, mat);
  phoenixParticleGroup.frustumCulled = false;
  phoenixParticleGroup.visible = false;
  phoenixParticleGroup.position.set(PHOENIX_MODEL_BASE_POSITION.x, PHOENIX_MODEL_BASE_POSITION.y, PHOENIX_MODEL_BASE_POSITION.z);
  phoenixParticleGroup.scale.setScalar(PHOENIX_MODEL_SCALE);
  phoenixParticleGroup.rotation.set(PHOENIX_MODEL_BASE_ROTATION_X, PHOENIX_MODEL_BASE_ROTATION_Y, 0);
  phoenixParticleGroup.renderOrder = 33;
  syncPhoenixParticleColors();
  scene.add(phoenixParticleGroup);

  // 初始化关节动画数据 (全矩阵 FK, 兼容 FBX 非均匀缩放祖先)
  var jCount = rig.jointCount;
  phoenixBindQ = [];
  phoenixLocalT = [];
  phoenixLocalS = [];
  phoenixLocalM = [];
  phoenixWorldM = [];
  phoenixAncM = [];
  phoenixDeltaQ = [];
  phoenixAnimMats = [];
  phoenixScratch = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
    q1: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    m1: new THREE.Matrix4(), m2: new THREE.Matrix4(), m3: new THREE.Matrix4(),
    ibm: [], axisX: new THREE.Vector3(1, 0, 0), axisY: new THREE.Vector3(0, 1, 0), axisZ: new THREE.Vector3(0, 0, 1)
  };
  for (var j = 0; j < jCount; j++) {
    var jd = rig.joints[j];
    phoenixBindQ.push(new THREE.Quaternion(jd.q[0], jd.q[1], jd.q[2], jd.q[3]));
    phoenixLocalT.push(new THREE.Vector3(jd.t[0], jd.t[1], jd.t[2]));
    phoenixLocalS.push(new THREE.Vector3(jd.s[0], jd.s[1], jd.s[2]));
    phoenixLocalM.push(new THREE.Matrix4().compose(
      phoenixLocalT[j], phoenixBindQ[j], phoenixLocalS[j]));
    phoenixWorldM.push(new THREE.Matrix4());
    phoenixAncM.push(jd.am ? new THREE.Matrix4().fromArray(jd.am) : new THREE.Matrix4());
    phoenixDeltaQ.push(new THREE.Quaternion());
    phoenixAnimMats.push(new THREE.Matrix4());
  }
  return phoenixParticleGroup;
}

// IBM: rig.ibmFlat (烘焙时写出, 模型单位列主序); 缺失时退化为 bind world 的逆矩阵
function phoenixEnsureIBM() {
  var rig = phoenixAsset.rig;
  if (!phoenixScratch.ibmReady) {
    var flat = rig.ibmFlat;
    for (var j = 0; j < rig.jointCount; j++) {
      var m = new THREE.Matrix4();
      if (flat) {
        m.fromArray(flat, j * 16);
      } else {
        phoenixScratch.m1.copy(phoenixLocalM[j]);
        m.copy(phoenixScratch.m1).invert();
      }
      phoenixScratch.ibm.push(m);
    }
    phoenixScratch.ibmReady = true;
  }
}

// ---- 程序化骨骼驱动 ----
// FK + 纹理上传 (ΔQ 已就位后调用)
function phoenixApplyFK() {
  var rig = phoenixAsset.rig;
  var q1 = phoenixScratch.q1;
  if (!phoenixScratch.qA) {
    phoenixScratch.qA = new THREE.Quaternion();
    phoenixScratch.tA = new THREE.Vector3();
    phoenixScratch.sA = new THREE.Vector3();
  }
  var qA = phoenixScratch.qA, tA = phoenixScratch.tA, sA = phoenixScratch.sA;
  // 原版动画采样 (帧间 lerp / 四元数 nlerp)
  var useAnim = !!(phoenixAnimData && rig.anim);
  var frameF = 0, f0 = 0, f1 = 0, fa = 0;
  if (useAnim) {
    var fps = rig.anim.frames / rig.anim.duration;
    frameF = Math.floor(phoenixAnimTime * fps) % rig.anim.frames + (phoenixAnimTime * fps) % 1;
    f0 = Math.floor(frameF) % rig.anim.frames;
    f1 = (f0 + 1) % rig.anim.frames;
    fa = frameF - Math.floor(frameF);
  }
  // --- 前向运动学 (全矩阵): world = parentWorld * local(ΔR) ---
  var rigJoints = rig.joints;
  var norm = rig.normalize;
  var sc = norm.scale, cx = norm.center[0], cy = norm.center[1], cz = norm.center[2];
  for (var j = 0; j < rigJoints.length; j++) {
    var jd = rigJoints[j];
    if (useAnim) {
      var b0 = (f0 * rigJoints.length + j) * 10;
      var b1 = (f1 * rigJoints.length + j) * 10;
      tA.set(
        phoenixAnimData[b0] + (phoenixAnimData[b1] - phoenixAnimData[b0]) * fa,
        phoenixAnimData[b0 + 1] + (phoenixAnimData[b1 + 1] - phoenixAnimData[b0 + 1]) * fa,
        phoenixAnimData[b0 + 2] + (phoenixAnimData[b1 + 2] - phoenixAnimData[b0 + 2]) * fa);
      var q0x = phoenixAnimData[b0 + 3], q0y = phoenixAnimData[b0 + 4], q0z = phoenixAnimData[b0 + 5], q0w = phoenixAnimData[b0 + 6];
      var q1x = phoenixAnimData[b1 + 3], q1y = phoenixAnimData[b1 + 4], q1z = phoenixAnimData[b1 + 5], q1w = phoenixAnimData[b1 + 6];
      // 符号对齐 (q ≡ -q): 防止跨符号 lerp 产生垃圾旋转
      if (q0x * q1x + q0y * q1y + q0z * q1z + q0w * q1w < 0) {
        q1x = -q1x; q1y = -q1y; q1z = -q1z; q1w = -q1w;
      }
      qA.set(
        q0x + (q1x - q0x) * fa,
        q0y + (q1y - q0y) * fa,
        q0z + (q1z - q0z) * fa,
        q0w + (q1w - q0w) * fa).normalize();
      sA.set(
        phoenixAnimData[b0 + 7] + (phoenixAnimData[b1 + 7] - phoenixAnimData[b0 + 7]) * fa,
        phoenixAnimData[b0 + 8] + (phoenixAnimData[b1 + 8] - phoenixAnimData[b0 + 8]) * fa,
        phoenixAnimData[b0 + 9] + (phoenixAnimData[b1 + 9] - phoenixAnimData[b0 + 9]) * fa);
      q1.copy(phoenixDeltaQ[j]).multiply(qA);
      phoenixLocalM[j].compose(tA, q1, sA);
    } else {
      // local 旋转 = ΔQ ⊗ bindQ
      q1.copy(phoenixDeltaQ[j]).multiply(phoenixBindQ[j]);
      phoenixLocalM[j].compose(phoenixLocalT[j], q1, phoenixLocalS[j]);
    }
    var src = jd.parent >= 0 ? phoenixWorldM[jd.parent] : phoenixAncM[j];
    phoenixWorldM[j].copy(src).multiply(phoenixLocalM[j]);
    // skinMatrix = N * world * IBM  (N = 归一化: 缩放 sc + 平移 -center*sc)
    var M = phoenixAnimMats[j].copy(phoenixWorldM[j]).multiply(phoenixScratch.ibm[j]);
    var e = M.elements;
    e[0] *= sc; e[1] *= sc; e[2] *= sc;
    e[4] *= sc; e[5] *= sc; e[6] *= sc;
    e[8] *= sc; e[9] *= sc; e[10] *= sc;
    e[12] = e[12] * sc - cx * sc;
    e[13] = e[13] * sc - cy * sc;
    e[14] = e[14] * sc - cz * sc;
    // 写入纹理: DataTexture 布局 = texel(x=j, y=row) → data[(row*jointCount + j)*4 + c]
    for (var r3 = 0; r3 < 4; r3++) {
      var ti = (r3 * rigJoints.length + j) * 4;
      phoenixJointData[ti] = e[r3 * 4];
      phoenixJointData[ti + 1] = e[r3 * 4 + 1];
      phoenixJointData[ti + 2] = e[r3 * 4 + 2];
      phoenixJointData[ti + 3] = e[r3 * 4 + 3];
    }
  }
  phoenixJointTexture.needsUpdate = true;
}

function phoenixUpdateRigPose(t) {
  var rig = phoenixAsset.rig;
  var chains = rig.chains;
  var q1 = phoenixScratch.q1, q2 = phoenixScratch.q2;
  var v1 = phoenixScratch.v1, v2 = phoenixScratch.v2, v3 = phoenixScratch.v3;
  var axX = phoenixScratch.axisX, axY = phoenixScratch.axisY, axZ = phoenixScratch.axisZ;
  // 原版动画在播时关闭程序化骨骼 (避免双重扑翅), 仅保留节拍闪光/缩放/变速
  var useAnim = !!(phoenixAnimData && rig.anim);
  var audioDrive = useAnim ? 0 : clampRange(bass * 0.55 + beatPulse * 0.75, 0, 1.2);
  if (!useAnim) {
  // ΔQ 清零
  for (var j = 0; j < rig.jointCount; j++) phoenixDeltaQ[j].set(0, 0, 0, 1);

  // 翅膀: 展翅姿态(绕局部X) + 节拍扑动 + 沿链相位滞后 — flapPhase 由外层按 dt 积分
  var flap = Math.sin(phoenixFlapPhase * Math.PI * 2);
  var flapAmp = 0.14 + audioDrive * 0.26;
  [[chains.leftWing, 1], [chains.rightWing, -1]].forEach(function (wc) {
    var list = wc[0], side = wc[1];
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      var depth = i / Math.max(1, list.length - 1);          // 0=翅根 1=翅尖
      var spread = 2.05 * (0.30 + depth * 0.72);             // 展翅基础角
      var flapAng = flap * flapAmp * (0.35 + depth * 0.75)
        + Math.sin(phoenixFlapPhase * Math.PI * 2 - depth * 0.9) * flapAmp * 0.30 * depth;
      phoenixQuatFromAxisAngle(axX, side * (spread + flapAng), phoenixDeltaQ[j]);
    }
  });

  // 尾羽: 慢摆 + 鼓点甩尾
  for (var i = 0; i < chains.tail.length; i++) {
    var j = chains.tail[i], depth = i / Math.max(1, chains.tail.length - 1);
    var ang = Math.sin(t * 0.9 - depth * 0.7) * 0.055 * (0.4 + depth)
      + Math.sin(t * 2.3 - depth * 1.1) * audioDrive * 0.035 * depth;
    phoenixQuatFromAxisAngle(axY, ang, phoenixDeltaQ[j]);
  }

  // 颈/头: 浮动 + 鼓点点头
  if (chains.head >= 0) {
    var jh = chains.head;
    phoenixQuatFromAxisAngle(axX, Math.sin(t * 0.7) * 0.045 + audioDrive * 0.05, q1);
    phoenixQuatFromAxisAngle(axY, Math.sin(t * 0.43 + 1.7) * 0.06, q2);
    q1.multiply(q2);
    phoenixDeltaQ[jh].copy(q1);
  }
  for (var i = 0; i < chains.neck.length; i++) {
    var j = chains.neck[i];
    var ang = Math.sin(t * 0.55 - i * 0.5) * 0.028;
    phoenixQuatFromAxisAngle(axX, ang, phoenixDeltaQ[j]);
  }

  // 下颌: 鸣叫 (鼓点张嘴, 同骷髅语言)
  if (chains.jaw >= 0) {
    var open = clampRange(0.25 + audioDrive * 0.75, 0, 1.1);
    phoenixQuatFromAxisAngle(axX, open * 0.42, phoenixDeltaQ[chains.jaw]);
  }

  // 冠羽链: 波浪飘动
  for (var i = 0; i < chains.hair.length; i++) {
    var j = chains.hair[i];
    var seedW = (j % 7) * 0.9;
    var ang = Math.sin(t * 1.3 + seedW) * 0.035 + Math.sin(t * 3.1 + seedW * 2.0) * audioDrive * 0.028;
    phoenixQuatFromAxisAngle(axZ, ang, phoenixDeltaQ[j]);
  }

  // 腿: 微收
  for (var i = 0; i < chains.legs.length; i++) {
    var j = chains.legs[i];
    var ang = Math.sin(t * 1.1 + i) * 0.02;
    phoenixQuatFromAxisAngle(axX, ang, phoenixDeltaQ[j]);
  }
  } // end !useAnim

  // FK + 纹理上传
  phoenixApplyFK();
}

function phoenixBreathOffset(t) {
  return {
    x: Math.sin(t * 0.31 + 1.2) * 0.030 + Math.sin(t * 0.57 + 0.6) * 0.012,
    y: Math.sin(t * 0.36 + 0.3) * 0.040 + Math.sin(t * 0.81 + 2.0) * 0.014,
    z: Math.sin(t * 0.23 + 2.4) * 0.028
  };
}

// ---- 飞行轨迹 ----
// 横向路径: none=原地 / circle=盘旋椭圆 / patrol=左右巡游 (旧单选 phoenixFlightMode 兼容迁移)
function phoenixFlightPathId() {
  var v = fx && fx.phoenixFlightPath;
  if (v === 'circle' || v === 'patrol') return v;
  var old = fx && fx.phoenixFlightMode;
  if (old === 'circle') return 'circle';
  if (old === 'patrol') return 'patrol';
  return 'none';
}
function phoenixFlightDiveOn() {
  if (fx && fx.phoenixFlightDive != null) return fx.phoenixFlightDive === true;
  return (fx && fx.phoenixFlightMode) === 'dive';   // 旧单选迁移兜底
}
// 最短角缓动 (yaw 跨 ±π 边界时不绕远路)
function phoenixEaseAngle(cur, target, k) {
  var d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}
// 椭圆平面基向量 (相机参照, 所见即所得): u=长轴(屏面内倾斜 alpha), w=短轴(绕长轴旋出屏面 beta)
// beta=0 侧立成一条线 (用户说的"一维直线"), beta=90 平铺在屏幕上; 圆心=注视点
function phoenixFlightBasis() {
  var m = camera.matrixWorld.elements;          // 列主序: 0-2=右 4-6=上 8-10=后(视线=-后)
  var rx = m[0], ry = m[1], rz = m[2];
  var ux = m[4], uy = m[5], uz = m[6];
  var vx = -m[8], vy = -m[9], vz = -m[10];
  var alpha = clampRange(Number(fx && fx.phoenixFlightTilt) || 0, 0, 90) * Math.PI / 180;
  var beta = clampRange(Number(fx && fx.phoenixFlightSpin) == null ? 60 : Number(fx && fx.phoenixFlightSpin), 0, 90) * Math.PI / 180;
  var ca = Math.cos(alpha), sa = Math.sin(alpha);
  var cb = Math.cos(beta), sb = Math.sin(beta);
  // n = 屏面内垂直于长轴; w = 短轴方向 = n·sinβ + 视线·cosβ
  var nx = -rx * sa + ux * ca, ny = -ry * sa + uy * ca, nz = -rz * sa + uz * ca;
  return {
    u: [rx * ca + ux * sa, ry * ca + uy * sa, rz * ca + uz * sa],
    w: [nx * sb + vx * cb, ny * sb + vy * cb, nz * sb + vz * cb]
  };
}
// 横向路径点 (不含俯冲): 圆心=相机注视点; 返回 null 表示无路径 (原地悬停)
function phoenixFlightPathPoint(p) {
  var mode = phoenixFlightPathId();
  if (mode === 'none') return null;
  var S = phoenixFlightScale;
  var out = { x: 0, y: 0, z: 0 };
  if (mode === 'circle') {
    var eSize = clampRange(Number(fx && fx.phoenixFlightSize) || 1, 1, 5);
    var ea = PHOENIX_FLIGHT_ELLIPSE.a * S * eSize, eb = PHOENIX_FLIGHT_ELLIPSE.b * S * eSize;
    var B = phoenixFlightBasis();
    out.x = (ea * Math.cos(p)) * B.u[0] + (eb * Math.sin(p)) * B.w[0];
    out.y = (ea * Math.cos(p)) * B.u[1] + (eb * Math.sin(p)) * B.w[1];
    out.z = (ea * Math.cos(p)) * B.u[2] + (eb * Math.sin(p)) * B.w[2];
  } else {
    out.x = 4.0 * S * Math.sin(p);              // 巡游: 过中心的横线
  }
  if (orbit && orbit.lookAt) {
    // 轨迹圆心 = 注视点 + 沿相机上方的抬升 (略高于屏幕中心)
    var m = camera.matrixWorld.elements;
    var lift = 1.1 * S;
    out.x += orbit.lookAt.x - PHOENIX_MODEL_BASE_POSITION.x + m[4] * lift;
    out.y += orbit.lookAt.y - PHOENIX_MODEL_BASE_POSITION.y + m[5] * lift;
    out.z += orbit.lookAt.z - PHOENIX_MODEL_BASE_POSITION.z + m[6] * lift;
  }
  return out;
}
// 当前叠加状态下的轨迹目标 {x,y,z, yaw(面向yaw绝对角), bank, pitch}; phase 由调用方推进
// 面向 = 3D 切向 (yaw+pitch): 轨迹怎么倾斜, 头就怎么朝
function phoenixFlightTarget() {
  var p = phoenixFlight.phase;
  var mode = phoenixFlightPathId();
  var T = { x: 0, y: 0, z: 0, yaw: null, bank: 0, pitch: 0 };
  var pt = phoenixFlightPathPoint(p);
  if (pt) {
    T.x = pt.x; T.y = pt.y; T.z = pt.z;
    var tx, ty, tz;
    if (mode === 'circle') {
      var eSize = clampRange(Number(fx && fx.phoenixFlightSize) || 1, 1, 5);
      var ea = PHOENIX_FLIGHT_ELLIPSE.a * phoenixFlightScale * eSize, eb = PHOENIX_FLIGHT_ELLIPSE.b * phoenixFlightScale * eSize;
      var B = phoenixFlightBasis();
      tx = (-ea * Math.sin(p)) * B.u[0] + (eb * Math.cos(p)) * B.w[0];
      ty = (-ea * Math.sin(p)) * B.u[1] + (eb * Math.cos(p)) * B.w[1];
      tz = (-ea * Math.sin(p)) * B.u[2] + (eb * Math.cos(p)) * B.w[2];
      T.bank = 0.30;                            // 向转弯内侧倾
    } else {
      tx = 4.0 * Math.cos(p); ty = 0; tz = 0;
      if (Math.abs(tx) > 0.18) T.yaw = tx > 0 ? Math.PI / 2 : -Math.PI / 2; // 面向行进方向
    }
    if (tx || ty || tz) {
      T.yaw = Math.atan2(tx, tz);
      T.pitch = -Math.atan2(ty, Math.sqrt(tx * tx + tz * tz)); // 低头为正: 路径向下时头朝下
    }
  }
  if (phoenixFlightDiveOn()) {                  // 俯冲: 独立相位, 可与盘旋/巡游叠加
    var ds = Math.sin(phoenixFlight.divePhase);
    T.y -= 1.9 * phoenixFlightScale * Math.pow(Math.max(0, ds), 1.5); // 俯冲-拉起 (下快上缓)
    T.pitch = (T.pitch || 0) + (ds > 0 ? 0.20 : -0.13); // 俯冲低头 / 拉起抬头
  }
  if (T.yaw == null) T.yaw = PHOENIX_MODEL_BASE_ROTATION_Y + PHOENIX_FLIGHT_FORWARD_YAW;
  return T;
}

// 轨迹虚线 (每帧跟随注视点/倾斜/大小参数重建, 160 段开销可忽略)
function phoenixUpdateFlightLine() {
  var show = fx && fx.phoenixFlightShowPath === true && phoenixFlightPathId() !== 'none' && phoenixOpacity > 0.01;
  if (!show) {
    if (phoenixFlightLine) phoenixFlightLine.visible = false;
    return;
  }
  if (!phoenixFlightLine) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(161 * 3), 3));
    var mat = new THREE.LineDashedMaterial({
      color: 0xff9a52,
      dashSize: 0.16,
      gapSize: 0.11,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    phoenixFlightLine = new THREE.Line(geo, mat);
    phoenixFlightLine.frustumCulled = false;
    phoenixFlightLine.renderOrder = 32;
    scene.add(phoenixFlightLine);
  }
  var pos = phoenixFlightLine.geometry.attributes.position;
  var arr = pos.array, N = 160;
  for (var i = 0; i <= N; i++) {
    var pt = phoenixFlightPathPoint(i / N * Math.PI * 2) || phoenixFlightPathPoint(0.001) || { x: 0, y: 0, z: 0 };
    arr[i * 3] = pt.x; arr[i * 3 + 1] = pt.y; arr[i * 3 + 2] = pt.z;
  }
  pos.needsUpdate = true;
  phoenixFlightLine.geometry.computeBoundingSphere();
  phoenixFlightLine.computeLineDistances();     // LineDashedMaterial 必需
  phoenixFlightLine.material.opacity = 0.5 * phoenixOpacity;
  phoenixFlightLine.visible = true;
}

function updatePhoenixParticleLayer(dt) {
  var fx = fxLayerFx(PHOENIX_PRESET_INDEX) || fx;   // 分预设: 凤凰层用自己的参数快照 (遮蔽全局 fx)
  var active = fxLayerActiveFor(PHOENIX_PRESET_INDEX);
  if (active && (!phoenixAsset.bin || !phoenixAsset.rig)) {
    if (!phoenixAsset.failed) loadPhoenixPresetAssets();
    return;
  }
  if (active) createPhoenixParticleLayer();
  if (!phoenixParticleGroup || !phoenixAsset.rig) return;
  var target = active ? 1 : 0;
  phoenixOpacity += (target - phoenixOpacity) * Math.min(1, dt * (active ? 3.0 : 2.4));
  if (phoenixOpacity < 0.006 && !active) {
    phoenixParticleGroup.visible = false;
    return;
  }
  phoenixParticleGroup.visible = true;
  phoenixEnsureIBM();
  var u = phoenixParticleGroup.material.uniforms;
  u.uOpacity.value = phoenixOpacity * clampRange(0.78 + (fx.intensity || 0.85) * 0.18, 0.56, 1.0);
  u.uParticleCount.value = clampRange(fx.particleCount == null ? 1 : fx.particleCount, 0.05, 1);
  u.uSpeed.value = clampRange(fx.speed || 1, 0.2, 2.5);
  // 粒子密度: 点云预设映射为点的视觉浓密度 (尺寸补偿)
  u.uDensityBoost.value = clampRange(Math.pow(clampRange(fx.particleDensity || 1, 1, 4), 0.5), 1.0, 2.0);

  // 鼓点增亮 (默认律动): 平滑亮度提升, 不再有尺寸/透明度闪跳
  var beatTransient = clampRange(Math.max(0, beatPulse - 0.16) / 0.84, 0, 1.35);
  var flashTarget = clampRange(Math.pow(beatTransient, 1.3) * 1.05 + Math.max(0, bass - 0.60) * 0.20 * beatTransient, 0, 1);
  phoenixBeatFlash += (flashTarget - phoenixBeatFlash) * Math.min(1, dt * (flashTarget > phoenixBeatFlash ? 14.0 : 5.0));
  u.uFlash.value = phoenixBeatFlash;
  u.uWingGlow.value = clampRange(bass * 0.5 + beatPulse * 0.5, 0, 1);

  // 粒子律动模式: beat=鼓点增亮 / breath=随机亮度漂移 / sweep=头→尾线光
  var rhythmMode = phoenixRhythmModeId();
  if (rhythmMode === 'breath') {
    phoenixBreath.hold -= dt;
    phoenixBreath.v += (phoenixBreath.target - phoenixBreath.v) * Math.min(1, dt * 0.35);
    if (phoenixBreath.hold <= 0 || Math.abs(phoenixBreath.target - phoenixBreath.v) < 0.12) {
      // 循环范围 0.4~9 (近暗→亮), 慢速漂移: τ≈2.9s, 停留 2.5~7s
      phoenixBreath.target = Math.random() * 10; // 循环范围 0~10
      phoenixBreath.hold = 2.5 + Math.random() * 4.5;
    }
  } else {
    phoenixBreath.v += (fxBrightnessFromSlider(fx.brightness) - phoenixBreath.v) * Math.min(1, dt * 2.0);
  }
  if (rhythmMode === 'sweep') {
    phoenixSweepPhase += dt * 0.36 * clampRange(fx.speed || 1, 0.3, 2.0); // 全程约 2.8s, 头→尾
    if (phoenixSweepPhase > 1.22) phoenixSweepPhase = 0; // 到尾部后留短暂间隔再从头扫
  } else {
    phoenixSweepPhase = 0;
  }
  u.uPhoenixBright.value = rhythmMode === 'breath'
    ? clampRange(phoenixBreath.v, 0, 20)
    : fxBrightnessFromSlider(fx.brightness);
  u.uBeatBright.value = rhythmMode === 'beat' ? phoenixBeatFlash : 0;
  u.uSweepOn.value = rhythmMode === 'sweep' ? 1 : 0;
  u.uSweepPos.value = clampRange(phoenixSweepPhase, 0, 1);

  // 骨骼驱动 (flapPhase 用真实 dt 积分); 原版动画: 运动速度滑杆 × 节拍变速 (基准放慢)
  phoenixFlapPhase += dt * (1.05 + clampRange(bass * 0.35 + beatPulse * 0.55, 0, 1.2) * 1.05);
  if (phoenixAnimData && phoenixAsset.rig && phoenixAsset.rig.anim) {
    var spd = clampRange(fx.speed || 1, 0.2, 2.5);
    // 节拍调制项随速度等比缩放: 低速时节拍抖动不再占主导
    phoenixAnimTime += dt * spd * (0.62 + clampRange(bass * 0.30 + beatPulse * 0.45, 0, 0.8) * (spd / 2.5));
  }
  phoenixUpdateRigPose(uniforms.uTime.value);

  // 飞行轨迹 (切换/叠加均缓动滑入, 不跳变); 速率轻度随速度滑杆缩放 (扑翅仍由滑杆主导) × 轨迹速度滑杆
  phoenixFlightScale = clampRange((orbit.radius || 8.4) / 8.4, 0.55, 1.35)
    * clampRange(Number(fx.phoenixFlightAmp) || 1, 0.3, 1.8);
  var flightSpd = clampRange(fx.speed || 1, 0.2, 2.5);
  var flightRate = (0.6 + 0.4 * flightSpd) * clampRange(Number(fx.phoenixFlightSpeed) || 1, 0.3, 2.5);
  var flightMode = phoenixFlightPathId();
  if (flightMode === 'circle') {
    // 椭圆弧长匀速: dθ = v·dt / |dP/dθ|; P = a·cosθ·u + b·sinθ·w (u⊥w 单位基)
    // |dP/dθ| = √(a²sin²θ + b²cos²θ) (用基准半轴, 缩放对 v 与 arc 同比抵消)
    var el = PHOENIX_FLIGHT_ELLIPSE;
    var sn = Math.sin(phoenixFlight.phase), cs = Math.cos(phoenixFlight.phase);
    var arc = Math.sqrt(el.a * el.a * sn * sn + el.b * el.b * cs * cs);
    phoenixFlight.phase += dt * el.speed * phoenixFlightScale * flightRate / Math.max(arc, 0.35);
  } else if (flightMode === 'patrol') {
    phoenixFlight.phase += dt * PHOENIX_FLIGHT_PATROL_RATE * phoenixFlightScale * flightRate;
  }
  if (phoenixFlightDiveOn()) {
    phoenixFlight.divePhase += dt * PHOENIX_FLIGHT_DIVE_RATE * phoenixFlightScale * flightRate;
  }
  phoenixUpdateFlightLine();
  var ft = phoenixFlightTarget();
  var flightEase = 1 - Math.exp(-dt * 2.4);
  phoenixFlight.offX += (ft.x - phoenixFlight.offX) * flightEase;
  phoenixFlight.offY += (ft.y - phoenixFlight.offY) * flightEase;
  phoenixFlight.offZ += (ft.z - phoenixFlight.offZ) * flightEase;
  phoenixFlight.yaw = phoenixEaseAngle(phoenixFlight.yaw, ft.yaw, flightEase);
  phoenixFlight.bank += (ft.bank - phoenixFlight.bank) * flightEase;
  phoenixFlight.pitch += (ft.pitch - phoenixFlight.pitch) * flightEase;

  // 呼吸漂移 + 节拍脉冲缩放
  var drift = phoenixBreathOffset(uniforms.uTime.value);
  var ampTarget = clampRange(bass * 0.005 + beatPulse * 0.055, 0, 0.085);
  phoenixAmpPulse += (ampTarget - phoenixAmpPulse) * Math.min(1, dt * (ampTarget > phoenixAmpPulse ? 11.0 : 4.0));
  var targetScale = PHOENIX_MODEL_SCALE * (1 + phoenixAmpPulse);
  phoenixParticleGroup.scale.x += (targetScale - phoenixParticleGroup.scale.x) * Math.min(1, dt * 4.6);
  phoenixParticleGroup.scale.y = phoenixParticleGroup.scale.x;
  phoenixParticleGroup.scale.z = phoenixParticleGroup.scale.x;
  // 位置滑杆偏移 (fx.phoenixPosX/Y): 所有轨迹模式 (原地/盘旋/巡游/俯冲) 统一生效
  var phoenixUserPosX = clampRange(Number(fx.phoenixPosX) || 0, -8, 8);
  var phoenixUserPosY = clampRange(Number(fx.phoenixPosY) || 0, -2.5, 2.5);
  phoenixParticleGroup.position.x = PHOENIX_MODEL_BASE_POSITION.x + phoenixUserPosX + drift.x + phoenixFlight.offX;
  phoenixParticleGroup.position.y = PHOENIX_MODEL_BASE_POSITION.y + phoenixUserPosY + drift.y + phoenixFlight.offY;
  phoenixParticleGroup.position.z = PHOENIX_MODEL_BASE_POSITION.z + drift.z + phoenixFlight.offZ;

  // 轨迹面向 + 手势/头部视差旋转 (同骷髅); yaw-π 还原为模型 rotY
  var targetRotY = (phoenixFlight.yaw - PHOENIX_FLIGHT_FORWARD_YAW) + (orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y);
  var targetRotX = PHOENIX_MODEL_BASE_ROTATION_X + phoenixFlight.pitch + (orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x);
  var rotEase = Math.min(1, dt * 7.4);
  phoenixParticleGroup.rotation.y = phoenixEaseAngle(phoenixParticleGroup.rotation.y, targetRotY, rotEase);
  phoenixParticleGroup.rotation.x += (targetRotX - phoenixParticleGroup.rotation.x) * rotEase;
  phoenixParticleGroup.rotation.z += (-phoenixFlight.bank - phoenixParticleGroup.rotation.z) * Math.min(1, dt * 6.0);
}

function clearPhoenixPresetResidue() {
  phoenixOpacity = 0;
  phoenixAmpPulse = 0;
  phoenixBeatFlash = 0;
  phoenixSweepPhase = 0;
  // 轨迹状态复位 (切回时从头开始, 无残留偏移)
  phoenixFlight.phase = 0;
  phoenixFlight.divePhase = 0;
  phoenixFlight.offX = 0;
  phoenixFlight.offY = 0;
  phoenixFlight.offZ = 0;
  phoenixFlight.yaw = PHOENIX_MODEL_BASE_ROTATION_Y + PHOENIX_FLIGHT_FORWARD_YAW;
  phoenixFlight.bank = 0;
  phoenixFlight.pitch = 0;
  if (!phoenixParticleGroup) {
    if (phoenixFlightLine) phoenixFlightLine.visible = false;
    return;
  }
  phoenixParticleGroup.visible = false;
  if (phoenixParticleGroup.material && phoenixParticleGroup.material.uniforms) {
    var u = phoenixParticleGroup.material.uniforms;
    if (u.uOpacity) u.uOpacity.value = 0;
    if (u.uFlash) u.uFlash.value = 0;
  }
}

// ---- 飞行轨迹控制 (动效面板, 仅凤凰预设显示) ----
// 横向路径三态按钮: 盘旋/巡游 互切, 再点当前项取消回原地; 俯冲独立开关可叠加
// ---- 凤凰配色模式 (default=火羽色 / solid=用户纯色 / cover=封面取色; 仅预设 9 显示) ----
function phoenixColorModeId() {
  return (fx && fx.phoenixColorMode === 'solid') || (fx && fx.phoenixColorMode === 'cover') ? fx.phoenixColorMode : 'default';
}
function setPhoenixColorMode(mode, silent) {
  var next = /^(solid|cover)$/.test(String(mode || '')) ? mode : 'default';
  fx.phoenixColorMode = next;
  updatePhoenixColorControlsUI();
  syncPhoenixParticleColors();
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixColorMode' });
  if (!silent) showToast('凤凰配色: ' + (next === 'default' ? '默认火羽' : next === 'solid' ? '纯色' : '封面取色'));
}
function setPhoenixSolidColor(color, silent) {
  fx.phoenixSolidColor = normalizeHexColor(color || fxDefaults.phoenixSolidColor || '#ff8a3c', '#ff8a3c');
  if (phoenixColorModeId() !== 'solid') fx.phoenixColorMode = 'solid';
  updatePhoenixColorControlsUI();
  syncPhoenixParticleColors();
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixSolidColor' });
  if (!silent) showToast('凤凰颜色: ' + String(fx.phoenixSolidColor).toUpperCase());
}
// ---- 粒子律动模式 (beat=鼓点增亮 / breath=亮度呼吸 / sweep=线光; 仅预设 9 显示) ----
function phoenixRhythmModeId() {
  return (fx && fx.phoenixRhythmMode === 'breath') || (fx && fx.phoenixRhythmMode === 'sweep') ? fx.phoenixRhythmMode : 'beat';
}
function setPhoenixRhythmMode(mode, silent) {
  var next = /^(breath|sweep)$/.test(String(mode || '')) ? mode : 'beat';
  fx.phoenixRhythmMode = next;
  if (next === 'breath') phoenixBreath.v = clampRange(Number(fx.brightness) || 1, 0.4, 20); // 从当前亮度出发
  phoenixSweepPhase = 0;
  updatePhoenixRhythmControlsUI();
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixRhythmMode' });
  if (!silent) showToast('粒子律动: ' + (next === 'beat' ? '鼓点增亮' : next === 'breath' ? '亮度呼吸' : '线光扫掠'));
}
function updatePhoenixRhythmControlsUI() {
  var mode = phoenixRhythmModeId();
  var bb = document.getElementById('pr-beat');
  var br = document.getElementById('pr-breath');
  var bs = document.getElementById('pr-sweep');
  if (bb) bb.classList.toggle('active', mode === 'beat');
  if (br) br.classList.toggle('active', mode === 'breath');
  if (bs) bs.classList.toggle('active', mode === 'sweep');
}

function updatePhoenixColorControlsUI() {  var mode = phoenixColorModeId();
  var bd = document.getElementById('pf-color-default');
  var bs = document.getElementById('pf-color-solid');
  var bv = document.getElementById('pf-color-cover');
  if (bd) bd.classList.toggle('active', mode === 'default');
  if (bs) bs.classList.toggle('active', mode === 'solid');
  if (bv) bv.classList.toggle('active', mode === 'cover');
  // 取色行: 仅 凤凰预设 + 纯色模式 显示 (预设门控由 updateSonicSeriesControlVisibility 负责)
  var row = document.getElementById('phoenix-color-picker-row');
  if (row) row.classList.toggle('fx-sonic-hidden', !(Number(fx && fx.preset) === 9 && mode === 'solid'));
  var color = normalizeHexColor(fx && fx.phoenixSolidColor || '#ff8a3c', '#ff8a3c');
  var picker = document.getElementById('phoenix-color-picker');
  var value = document.getElementById('phoenix-color-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}

function setPhoenixFlightPath(path) {
  var cur = phoenixFlightPathId();
  var next = (path === 'circle' || path === 'patrol') ? path : 'none';
  fx.phoenixFlightPath = (cur === next) ? 'none' : next;
  if (typeof updatePhoenixFlightControlsUI === 'function') updatePhoenixFlightControlsUI();
  if (typeof showToast === 'function') {
    showToast('飞行轨迹: ' + (fx.phoenixFlightPath === 'circle' ? '盘旋飞行' : fx.phoenixFlightPath === 'patrol' ? '左右巡游' : '原地悬停'));
  }
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixFlightPath' });
}
function togglePhoenixFlightDive() {
  fx.phoenixFlightDive = !phoenixFlightDiveOn();
  if (typeof updatePhoenixFlightControlsUI === 'function') updatePhoenixFlightControlsUI();
  if (typeof showToast === 'function') showToast(fx.phoenixFlightDive ? '俯冲叠加: 开' : '俯冲叠加: 关');
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixFlightDive' });
}
function togglePhoenixFlightShowPath() {
  fx.phoenixFlightShowPath = fx.phoenixFlightShowPath !== true;
  if (typeof updatePhoenixFlightControlsUI === 'function') updatePhoenixFlightControlsUI();
  if (typeof showToast === 'function') showToast(fx.phoenixFlightShowPath ? '轨迹显示: 开' : '轨迹显示: 关');
  if (typeof saveLyricLayout === 'function') saveLyricLayout({ user: true, reason: 'phoenixFlightShowPath' });
}
function updatePhoenixFlightControlsUI() {
  var path = phoenixFlightPathId();
  var bc = document.getElementById('pf-path-circle');
  var bp = document.getElementById('pf-path-patrol');
  var bd = document.getElementById('pf-dive');
  var bs = document.getElementById('pf-showpath');
  if (bc) bc.classList.toggle('active', path === 'circle');
  if (bp) bp.classList.toggle('active', path === 'patrol');
  if (bd) bd.classList.toggle('active', phoenixFlightDiveOn());
  if (bs) bs.classList.toggle('active', fx && fx.phoenixFlightShowPath === true);
}
