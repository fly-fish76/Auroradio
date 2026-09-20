// ============================================================
//  phoenix_bake.js — 凤凰 GLB → 粒子点云 bin + 骨骼 rig JSON
//  用法: node tools/phoenix_bake.js <input.glb> [点数]
//  输出: public/assets/phoenix-points.bin (16 float/点)
//        public/assets/phoenix-rig.json
//  点格式: x,y,z | kind | seed | j0..j3 | w0..w3 | r,g,b (linear)
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = process.argv[2] || 'C:/Users/dc/Downloads/real-time_bones_demo_phoenix_bird.glb';
const TARGET_POINTS = Number(process.argv[3]) || 46000;
const OUT_BIN = path.join(__dirname, '..', 'public', 'assets', 'phoenix-points.bin');
const OUT_RIG = path.join(__dirname, '..', 'public', 'assets', 'phoenix-rig.json');

// ---------- GLB 容器 ----------
const file = fs.readFileSync(SRC);
if (file.readUInt32LE(0) !== 0x46546C67) throw new Error('not GLB');
const jsonLen = file.readUInt32LE(12);
const json = JSON.parse(file.slice(20, 20 + jsonLen).toString('utf8'));
const binHeader = 20 + jsonLen;
const binLen = file.readUInt32LE(binHeader);
const binBuf = file.subarray(binHeader + 8, binHeader + 8 + binLen);
console.log('GLB ok: meshes', json.meshes.length, 'nodes', json.nodes.length, 'bin', (binLen / 1024).toFixed(0) + 'KB');

// ---------- accessor 读取 ----------
const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(accIndex) {
  const acc = json.accessors[accIndex];
  const numComp = NUM_COMP[acc.type];
  const compSize = COMP_SIZE[acc.componentType];
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride || numComp * compSize;
  const base = binBuf.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(binBuf.buffer, base);
  const out = new Float32Array(acc.count * numComp);
  const norm = acc.normalized;
  for (let i = 0; i < acc.count; i++) {
    const off = i * stride;
    for (let c = 0; c < numComp; c++) {
      const p = off + c * compSize;
      let v;
      switch (acc.componentType) {
        case 5120: v = dv.getInt8(p); break;
        case 5121: v = dv.getUint8(p); break;
        case 5122: v = dv.getInt16(p, true); break;
        case 5123: v = dv.getUint16(p, true); break;
        case 5125: v = dv.getUint32(p, true); break;
        default: v = dv.getFloat32(p, true);
      }
      if (norm) {
        if (acc.componentType === 5120) v = Math.max(v / 127, -1);
        else if (acc.componentType === 5121) v = v / 255;
        else if (acc.componentType === 5122) v = Math.max(v / 32767, -1);
        else if (acc.componentType === 5123) v = v / 65535;
      }
      out[i * numComp + c] = v;
    }
  }
  return { data: out, numComp, count: acc.count };
}
function readAccessorRaw(accIndex) { // 整数型原始值 (关节索引用)
  const acc = json.accessors[accIndex];
  const numComp = NUM_COMP[acc.type];
  const compSize = COMP_SIZE[acc.componentType];
  const bv = json.bufferViews[acc.bufferView];
  const stride = bv.byteStride || numComp * compSize;
  const base = binBuf.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(binBuf.buffer, base);
  const out = new Uint16Array(acc.count * numComp);
  for (let i = 0; i < acc.count; i++) {
    const off = i * stride;
    for (let c = 0; c < numComp; c++) {
      const p = off + c * compSize;
      let v;
      switch (acc.componentType) {
        case 5120: v = dv.getInt8(p); break;
        case 5121: v = dv.getUint8(p); break;
        case 5122: v = dv.getInt16(p, true); break;
        case 5123: v = dv.getUint16(p, true); break;
        case 5125: v = dv.getUint32(p, true); break;
        default: v = dv.getFloat32(p, true);
      }
      out[i * numComp + c] = v;
    }
  }
  return out;
}

// ---------- 节点层级 world 矩阵 ----------
// mat 存成 Float32Array(16) 列主序 (同 glTF/three.js)
function matIdentity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function matMultiply(a, b) { // a * b
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function nodeLocalMatrix(n) {
  if (n.matrix) return new Float32Array(n.matrix);
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const rx = 1 - (yy + zz), ry = xy - wz, rz = xz + wy;
  const ux = xy + wz, uy = 1 - (xx + zz), uz = yz - wx;
  const ax = xz - wy, ay = yz + wx, az = 1 - (xx + yy);
  // 列主序旋转矩阵
  const m = new Float32Array(16);
  m[0] = rx * s[0]; m[1] = ux * s[0]; m[2] = ax * s[0];
  m[4] = ry * s[1]; m[5] = uy * s[1]; m[6] = ay * s[1];
  m[8] = rz * s[2]; m[9] = uz * s[2]; m[10] = az * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
const nodeWorld = new Array(json.nodes.length);
const nodeParent = new Array(json.nodes.length).fill(-1);
(function walk(idxList, parentM) {
  for (const idx of idxList) {
    const n = json.nodes[idx];
    nodeParent[idx] = parentM === null ? -2 : idx; // 占位，下一行修正
    nodeWorld[idx] = matMultiply(parentM, nodeLocalMatrix(n));
    if (n.children) walk(n.children, nodeWorld[idx]);
  }
})(json.scenes[json.scene || 0].nodes, matIdentity());
// 修正 parent (上面 walk 没记 parent index，重走一遍)
(function markParent(idxList, parent) {
  for (const idx of idxList) {
    nodeParent[idx] = parent;
    if (json.nodes[idx].children) markParent(json.nodes[idx].children, idx);
  }
})(json.scenes[json.scene || 0].nodes, -1);

// ---------- skin / IBM ----------
const skin = json.skins[0];
const jointOfNode = {}; // nodeIndex -> joint index
skin.joints.forEach((nj, j) => { jointOfNode[nj] = j; });
const ibmAcc = readAccessor(skin.inverseBindMatrices); // MAT4 列主序
const IBM = ibmAcc.data; // 16 * jointCount
const JOINT_COUNT = skin.joints.length;
console.log('skin joints:', JOINT_COUNT);

// ---------- PNG 解码 (RGBA8/RGB8, 非隔行) ----------
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, colorType = 0, bitDepth = 0, plte = null, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('PNG bitDepth ' + bitDepth + ' unsupported');
  const bppMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bpp = bppMap[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let p = 0;
  const paeth = (a, b, c) => {
    const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const rowStart = y * stride, prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const rv = raw[p++];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const ul = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let v;
      if (f === 0) v = rv;
      else if (f === 1) v = rv + left;
      else if (f === 2) v = rv + up;
      else if (f === 3) v = rv + ((left + up) >> 1);
      else v = rv + paeth(left, up, ul);
      out[rowStart + x] = v & 0xff;
    }
  }
  function pixel(u, v) { // glTF UV: v=0 顶部
    const xi = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1))));
    const yi = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
    const i = (yi * w + xi) * bpp;
    if (colorType === 6) return [out[i] / 255, out[i + 1] / 255, out[i + 2] / 255];
    if (colorType === 2) return [out[i] / 255, out[i + 1] / 255, out[i + 2] / 255];
    if (colorType === 3) {
      const pi = out[i] * 3;
      return [plte[pi] / 255, plte[pi + 1] / 255, plte[pi + 2] / 255];
    }
    const g = out[i] / 255; return [g, g, g];
  }
  return { w, h, pixel, colorType };
}

// ---------- 材质 → 贴图 ----------
const texCache = {};
function baseColorSampler(materialIndex) {
  const mat = json.materials[materialIndex];
  const bct = mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
  if (!bct) return () => [0.8, 0.8, 0.8];
  const tex = json.textures[bct.index];
  const img = json.images[tex.source];
  if (!texCache[img.bufferView]) {
    const bv = json.bufferViews[img.bufferView];
    texCache[img.bufferView] = decodePNG(binBuf.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
    console.log('decoded PNG', img.bufferView, texCache[img.bufferView].w + 'x' + texCache[img.bufferView].h, 'colorType', texCache[img.bufferView].colorType);
  }
  const t = texCache[img.bufferView];
  return (u, v) => t.pixel(u, v);
}

// ---------- kind 分类 (按关节名) ----------
function kindForJoint(jointIdx) {
  const name = (json.nodes[skin.joints[jointIdx]].name || '').toLowerCase();
  if (name.includes('wing_9') || name.includes('wing_8')) return 0.32;       // 翅尖
  if (name.includes('left_wing')) return 0.30;
  if (name.includes('right_wing')) return 0.34;
  if (name.includes('tail')) return 0.50;
  if (name.includes('hair')) return 0.60;                                    // 冠羽/颈羽
  if (name.includes('jaw')) return 0.20;
  if (name.includes('head') || name.includes('neck')) return 0.24;
  if (name.includes('thigh') || name.includes('calf') || name.includes('foot')) return 0.15;
  return 0.10;                                                               // 躯干
}

// ---------- 收集三角形 ----------
const primitives = [];
json.meshes.forEach((m, mi) => {
  m.primitives.forEach((p, pi) => {
    primitives.push({
      meshIndex: mi, materialIndex: p.material || 0,
      pos: readAccessor(p.attributes.POSITION),
      idx: readAccessorRaw(p.indices),
      joints: readAccessorRaw(p.attributes.JOINTS_0),
      weights: readAccessor(p.attributes.WEIGHTS_0),
      uv: readAccessor(p.attributes.TEXCOORD_0),
      colorSampler: null
    });
  });
});
console.log('primitives:', primitives.length);

// 每图元三角形累计面积
const triLists = primitives.map(p => {
  const { data: P, count: vCount } = p.pos;
  const I = p.idx;
  const tris = [];
  let total = 0;
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f], b = I[f + 1], c = I[f + 2];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    tris.push({ a, b, c, area });
    total += area;
  }
  return { tris, total };
});
const grandTotal = triLists.reduce((s, t) => s + t.total, 0);
console.log('total surface area:', grandTotal.toFixed(2));

// ---------- 蒙皮 bind 矩阵 (关节) ----------
const bindSkinM = new Array(JOINT_COUNT);
for (let j = 0; j < JOINT_COUNT; j++) {
  const nj = skin.joints[j];
  bindSkinM[j] = matMultiply(nodeWorld[nj], new Float32Array(IBM.slice(j * 16, j * 16 + 16)));
}

// ---------- 采样 ----------
const seedRand = (function () { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

function transformPoint(M, x, y, z, out, o) {
  out[o] = M[0] * x + M[4] * y + M[8] * z + M[12];
  out[o + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
  out[o + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
}

const floatsPerPoint = 16;
const outData = new Float32Array(TARGET_POINTS * floatsPerPoint);
let made = 0, guard = 0;
const skinAcc = new Map(); // joint -> w
const tmp = [0, 0, 0], tmp2 = [0, 0, 0], tmp3 = [0, 0, 0];
// 世界坐标 bbox (供 rig normalize), 在采样时累计
let wMinX = 1e9, wMinY = 1e9, wMinZ = 1e9, wMaxX = -1e9, wMaxY = -1e9, wMaxZ = -1e9;

while (made < TARGET_POINTS && guard < TARGET_POINTS * 20) {
  guard++;
  // 按面积选图元+三角形
  let pick = seedRand() * grandTotal, primIdx = 0;
  for (let pi = 0; pi < triLists.length; pi++) {
    if (pick <= triLists[pi].total) { primIdx = pi; break; }
    pick -= triLists[pi].total;
  }
  const { tris } = triLists[primIdx];
  let pick2 = seedRand() * triLists[primIdx].total, ti = 0;
  for (let k = 0; k < tris.length; k++) {
    if (pick2 <= tris[k].area) { ti = k; break; }
    pick2 -= tris[k].area;
  }
  const tri = tris[ti];
  if (!tri || tri.area < 1e-9) continue;

  const prim = primitives[primIdx];
  const P = prim.pos.data, W = prim.weights.data, J = prim.joints, UV = prim.uv.data;
  let r1 = Math.sqrt(seedRand()), r2 = seedRand();
  const u = 1 - r1, v = r1 * (1 - r2), wB = r1 * r2; // 重心坐标

  // 插值位置 (模型局部)
  const lx = P[tri.a * 3] * u + P[tri.b * 3] * v + P[tri.c * 3] * wB;
  const ly = P[tri.a * 3 + 1] * u + P[tri.b * 3 + 1] * v + P[tri.c * 3 + 1] * wB;
  const lz = P[tri.a * 3 + 2] * u + P[tri.b * 3 + 2] * v + P[tri.c * 3 + 2] * wB;

  // 累计蒙皮权重: 每顶点4组 * 3顶点, 按重心加权
  skinAcc.clear();
  const verts = [tri.a, tri.b, tri.c], bary = [u, v, wB];
  for (let vi = 0; vi < 3; vi++) {
    const vv = verts[vi], bw = bary[vi];
    for (let k = 0; k < 4; k++) {
      const wgt = W[vv * 4 + k];
      if (wgt <= 0.001) continue;
      const jid = J[vv * 4 + k];
      skinAcc.set(jid, (skinAcc.get(jid) || 0) + wgt * bw);
    }
  }
  const pairs = [...skinAcc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const wSum = pairs.reduce((s, pr) => s + pr[1], 0);
  if (wSum <= 0.0001) continue;

  // 变换到 bind 世界位姿 (按权重累加)
  tmp[0] = tmp[1] = tmp[2] = 0;
  for (const [jid, wgt] of pairs) {
    const M = bindSkinM[jid];
    tmp2[0] = M[0] * lx + M[4] * ly + M[8] * lz + M[12];
    tmp2[1] = M[1] * lx + M[5] * ly + M[9] * lz + M[13];
    tmp2[2] = M[2] * lx + M[6] * ly + M[10] * lz + M[14];
    tmp[0] += tmp2[0] * (wgt / wSum);
    tmp[1] += tmp2[1] * (wgt / wSum);
    tmp[2] += tmp2[2] * (wgt / wSum);
  }
  wMinX = Math.min(wMinX, tmp[0]); wMaxX = Math.max(wMaxX, tmp[0]);
  wMinY = Math.min(wMinY, tmp[1]); wMaxY = Math.max(wMaxY, tmp[1]);
  wMinZ = Math.min(wMinZ, tmp[2]); wMaxZ = Math.max(wMaxZ, tmp[2]);

  // 颜色 (UV 插值 → 贴图, sRGB → linear)
  const uu = UV[tri.a * 2] * u + UV[tri.b * 2] * v + UV[tri.c * 2] * wB;
  const vv2 = UV[tri.a * 2 + 1] * u + UV[tri.b * 2 + 1] * v + UV[tri.c * 2 + 1] * wB;
  if (!prim.colorSampler) prim.colorSampler = baseColorSampler(prim.materialIndex);
  const rgb = prim.colorSampler(uu, vv2);
  // 直通 sRGB 原值 (项目渲染管线 ShaderMaterial 无输出 gamma, 原值≈显示值)
  const lr = rgb[0], lg = rgb[1], lb = rgb[2];

  // 主导关节 → kind
  const domJoint = pairs[0][0];
  const o = made * floatsPerPoint;
  // 重要: 写入模型局部坐标 (蒙皮变换的输入), 世界归一化由运行时关节矩阵 N 承担
  outData[o] = lx; outData[o + 1] = ly; outData[o + 2] = lz;
  outData[o + 3] = kindForJoint(domJoint);
  outData[o + 4] = seedRand() * 1000;
  outData[o + 5] = pairs[0][0]; outData[o + 6] = pairs[1] ? pairs[1][0] : 0;
  outData[o + 7] = pairs[2] ? pairs[2][0] : 0; outData[o + 8] = pairs[3] ? pairs[3][0] : 0;
  outData[o + 9] = pairs[0][1] / wSum; outData[o + 10] = pairs[1] ? pairs[1][1] / wSum : 0;
  outData[o + 11] = pairs[2] ? pairs[2][1] / wSum : 0; outData[o + 12] = pairs[3] ? pairs[3][1] / wSum : 0;
  outData[o + 13] = lr; outData[o + 14] = lg; outData[o + 15] = lb;
  made++;
}
console.log('sampled points:', made);

// ---------- 归一化参数 (世界坐标; bin 内保持模型局部坐标不动) ----------
const minX = wMinX, minY = wMinY, minZ = wMinZ, maxX = wMaxX, maxY = wMaxY, maxZ = wMaxZ;
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
const height = maxY - minY, widthX = maxX - minX, depthZ = maxZ - minZ;
// 目标: 高度 ≈ 2.2 单位 (与骷髅相当); 翅膀展开会更宽, 属预期
const SCALE = 2.2 / height;
console.log('world bbox:', widthX.toFixed(2), height.toFixed(2), depthZ.toFixed(2), '→ scale', SCALE.toFixed(4));

fs.writeFileSync(OUT_BIN, Buffer.from(outData.buffer, 0, made * floatsPerPoint * 4));

// ---------- rig JSON ----------
// 根关节 (parent==-1) 可能挂着非关节祖先链 (FBX 导入的旋转/缩放节点),
// 运行时 FK 需要补上这段变换, 否则骨架朝向/位置与烘焙不一致
function decomposeTRS(m) {
  const t = [m[12], m[13], m[14]];
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  // 列主序旋转矩阵 (去缩放)
  const m00 = m[0] / sx, m01 = m[4] / sy, m02 = m[8] / sz;
  const m10 = m[1] / sx, m11 = m[5] / sy, m12 = m[9] / sz;
  const m20 = m[2] / sx, m21 = m[6] / sy, m22 = m[10] / sz;
  // 矩阵→四元数 (Shepperd)
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1.0) * 2;
    w = 0.25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S;
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S;
  } else if (m11 > m22) {
    const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S;
  } else {
    const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S;
  }
  return { t, q: [x, y, z, w], s: [sx, sy, sz] };
}
const rigJoints = [];
for (let j = 0; j < JOINT_COUNT; j++) {
  const n = json.nodes[skin.joints[j]];
  const parentNode = nodeParent[skin.joints[j]];
  const parentJoint = parentNode !== undefined && parentNode >= 0 && jointOfNode[parentNode] !== undefined
    ? jointOfNode[parentNode] : -1;
  // bindLocal: node 本地 TRS (无则单位)
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const entry = {
    name: n.name || ('joint_' + j),
    parent: parentJoint,
    t: t, q: q, s: s,
    // bind 世界位 (归一化后, 便于调试/轴向选择)
    bw: [
      (nodeWorld[skin.joints[j]][12] - cx) * SCALE,
      (nodeWorld[skin.joints[j]][13] - cy) * SCALE,
      (nodeWorld[skin.joints[j]][14] - cz) * SCALE
    ]
  };
  if (parentJoint === -1 && parentNode >= 0) {
    // 非关节祖先的世界矩阵 (含 FBX 非均匀缩放, 必须整矩阵传递避免剪切丢失)
    entry.am = Array.from(nodeWorld[parentNode]);
  }
  rigJoints.push(entry);
}
// IBM 用归一化坐标系换算: skinMatrix_worldNorm = S_norm * nodeWorld * IBM, S_norm = translate(-c)*scale(s)
// 运行时直接用: M = nodeWorldAnim(未归一化) * IBM, 再在 shader 外对 group 应用归一化? 不可行(逐点变换).
// 正确做法: 归一化也作用于关节矩阵: M' = N * M * N⁻¹? 采样点已经归一化, 关节矩阵必须匹配同一变换:
// bind 点世界 p' = Σ w * (nodeWorld * IBM) * p_local. 归一化后 p'' = S * p'. 运行时蒙皮:
// p'' = Σ w * (S * nodeWorldAnim * IBM) * p_local → 运行时关节矩阵 = S * nodeWorldAnim * IBM.
// rig 里存 N = S (平移-居中+缩放) 参数, 运行时组装.
const rig = {
  jointCount: JOINT_COUNT,
  normalize: { center: [cx, cy, cz], scale: SCALE },
  bindPose: 'rest',
  joints: rigJoints,
  // 原始 IBM (模型单位, 列主序 MAT4), 运行时 M' = N * world * IBM
  ibmFlat: Array.from(IBM),
  chains: {
    leftWing: [], rightWing: [], tail: [], jaw: -1, head: -1,
    neck: [], hair: [], legs: []
  }
};
// 关节深度 (链排序用)
const jointDepth = new Array(JOINT_COUNT).fill(0);
(function calcDepth() {
  for (let j = 0; j < JOINT_COUNT; j++) {
    let d = 0, cur = j;
    while (rigJoints[cur].parent >= 0 && d < 100) { cur = rigJoints[cur].parent; d++; }
    jointDepth[j] = d;
    rigJoints[j].depth = d;
  }
})();
rigJoints.forEach((j, i) => {
  const nm = j.name.toLowerCase();
  if (nm.includes('left_wing')) rig.chains.leftWing.push(i);
  if (nm.includes('right_wing')) rig.chains.rightWing.push(i);
  if (nm.includes('tail')) rig.chains.tail.push(i);
  if (nm.includes('jaw')) rig.chains.jaw = i;
  if (nm.includes('head')) rig.chains.head = i;
  if (nm.includes('neck')) rig.chains.neck.push(i);
  if (nm.includes('hair')) rig.chains.hair.push(i);
  if (nm.includes('thigh') || nm.includes('calf') || nm.includes('foot')) rig.chains.legs.push(i);
});
// 链按层级深度排序 (翅根→翅尖)
rig.chains.leftWing.sort((a, b) => jointDepth[a] - jointDepth[b]);
rig.chains.rightWing.sort((a, b) => jointDepth[a] - jointDepth[b]);
rig.chains.tail.sort((a, b) => jointDepth[a] - jointDepth[b]);
rig.chains.neck.sort((a, b) => jointDepth[a] - jointDepth[b]);
fs.writeFileSync(OUT_RIG, JSON.stringify(rig));

// kind 统计
const kindCount = {};
for (let i = 0; i < made; i++) {
  const k = outData[i * floatsPerPoint + 3].toFixed(2);
  kindCount[k] = (kindCount[k] || 0) + 1;
}
console.log('kind histogram:', kindCount);

// ---------- FK 自检: rig 数据模拟运行时 FK (ΔQ=0) vs GLB nodeWorld ----------
function composeTRS(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
(function fkSelfCheck() {
  const fkWorld = new Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const jd = rigJoints[j];
    const L = composeTRS(jd.t, jd.q, jd.s);
    let src;
    if (jd.parent >= 0) src = fkWorld[jd.parent];
    else if (jd.am) src = new Float32Array(jd.am);
    else src = matIdentity();
    fkWorld[j] = matMultiply(src, L);
  }
  let maxErr = 0, maxErrJoint = -1, maxErrComp = -1;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const ref = nodeWorld[skin.joints[j]];
    for (let k = 0; k < 16; k++) {
      const err = Math.abs(fkWorld[j][k] - ref[k]);
      if (err > maxErr) { maxErr = err; maxErrJoint = j; maxErrComp = k; }
    }
  }
  console.log('FK self-check: max|Δ| =', maxErr.toExponential(2),
    '@ joint', maxErrJoint, rigJoints[maxErrJoint] && rigJoints[maxErrJoint].name, 'comp', maxErrComp,
    maxErr < 1e-3 ? '✓ PASS' : '✗ FAIL');
})();

console.log('bin:', (made * floatsPerPoint * 4 / 1024 / 1024).toFixed(2) + 'MB →', OUT_BIN);
console.log('rig:', rigJoints.length, 'joints →', OUT_RIG);

// ---------- 动画烘焙: 均匀重采样 → phoenix-anim.bin ----------
// 布局: 帧 f, 关节 j → 10 float [tx,ty,tz, qx,qy,qz,qw, sx,sy,sz]
// bin 大小 = frames * jointCount * 10 * 4 字节
// 源动画关键帧时间不均匀 → 速度曲线有台阶, 慢放时可见顿挫;
// 重采样后做时间平滑: 平移 ±2 帧 / 旋转 ±1 帧 (保留扑翅力度, 抹平速度台阶)
const ANIM_FRAMES = 200;
function bakeAnimation() {
  const anims = json.animations || [];
  if (!anims.length) { console.log('no animations in source GLB — skip anim bake'); return; }
  const anim = anims[0];
  // 每通道: 采样时间数组 + 输出数组
  const channels = anim.channels.map(ch => {
    const s = anim.samplers[ch.sampler];
    const inAcc = readAccessor(s.input);          // SCALAR
    const outAcc = readAccessor(s.output);        // VEC3/VEC4
    return {
      joint: jointOfNode[ch.target.node],
      path: ch.target.path,
      interp: s.interpolation || 'LINEAR',
      times: inAcc.data,
      out: outAcc.data,
      ncomp: outAcc.numComp
    };
  }).filter(ch => ch.joint !== undefined);
  let duration = 0;
  channels.forEach(ch => { for (const t of ch.times) duration = Math.max(duration, t); });
  // 采样
  const sampleData = new Float32Array(ANIM_FRAMES * JOINT_COUNT * 10);
  const scratch = new Map(); // channel 缓存游标
  for (let f = 0; f < ANIM_FRAMES; f++) {
    const t = (f / ANIM_FRAMES) * duration;
    for (const ch of channels) {
      // 找区间 (times 单调递增, 线性扫描 + 游标)
      let key = scratch.get(ch);
      if (key === undefined) key = 0;
      while (key < ch.times.length - 2 && ch.times[key + 1] <= t) key++;
      scratch.set(ch, key);
      const t0 = ch.times[key], t1 = ch.times[Math.min(key + 1, ch.times.length - 1)];
      const span = t1 - t0;
      let u = span > 1e-9 ? (t - t0) / span : 0;
      u = Math.max(0, Math.min(1, u));
      const nc = ch.ncomp;
      const i0 = key * nc, i1 = Math.min(key + 1, ch.times.length - 1) * nc;
      const val = new Array(nc);
      for (let c = 0; c < nc; c++) val[c] = ch.out[i0 + c] + (ch.out[i1 + c] - ch.out[i0 + c]) * u;
      if (ch.path === 'rotation') { // 四元数: 符号对齐 + 归一化 (q 与 -q 同旋转, 跨帧翻转会让插值/平滑产生垃圾)
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += ch.out[i0 + c] * ch.out[i1 + c];
        const sgn = dot < 0 ? -1 : 1;
        for (let c = 0; c < 4; c++) {
          const a = ch.out[i0 + c], b = ch.out[i1 + c] * sgn;
          val[c] = a + (b - a) * u;
        }
        const len = Math.hypot(val[0], val[1], val[2], val[3]) || 1;
        val[0] /= len; val[1] /= len; val[2] /= len; val[3] /= len;
      }
      const base = (f * JOINT_COUNT + ch.joint) * 10;
      const off = ch.path === 'translation' ? 0 : ch.path === 'rotation' ? 3 : 7;
      for (let c = 0; c < nc; c++) sampleData[base + off + c] = val[c];
    }
  }
  // 缺省关节 (无通道): 用 bind TRS 填充
  for (let j = 0; j < JOINT_COUNT; j++) {
    const jd = rigJoints[j];
    let has = false;
    for (const ch of channels) if (ch.joint === j) { has = true; break; }
    if (has) continue;
    for (let f = 0; f < ANIM_FRAMES; f++) {
      const base = (f * JOINT_COUNT + j) * 10;
      for (let c = 0; c < 3; c++) {
        sampleData[base + c] = jd.t[c];
        sampleData[base + 3 + c] = jd.q[c];
        sampleData[base + 7 + c] = jd.s[c];
      }
      sampleData[base + 6] = jd.q[3];
    }
  }
  // 时间平滑 (环形): 通道分量级 box blur — 平移/缩放 ±2 帧, 四元数 ±1 帧 (先符号对齐再平均, 防止 q/-q 抵消)
  function smoothComponent(stride, offset, radius) {
    const src = Float32Array.from(sampleData);
    for (let f = 0; f < ANIM_FRAMES; f++) {
      for (let j = 0; j < JOINT_COUNT; j++) {
        const base = (f * JOINT_COUNT + j) * 10;
        for (let c = 0; c < 10; c++) {
          if (c >= 3 && c < 7) continue; // 四元数单独处理
          let sum = 0, n = 0;
          for (let k = -radius; k <= radius; k++) {
            const ff = (f + k + ANIM_FRAMES) % ANIM_FRAMES;
            sum += src[(ff * JOINT_COUNT + j) * 10 + c];
            n++;
          }
          sampleData[base + c] = sum / n;
        }
        // 四元数 ±1 帧平滑: 逐邻居符号对齐到中心帧, 再平均 + 归一化
        const bC = (f * JOINT_COUNT + j) * 10 + 3;
        let q = [0, 0, 0, 0];
        for (let k = -1; k <= 1; k++) {
          const ff = (f + k + ANIM_FRAMES) % ANIM_FRAMES;
          const b2 = (ff * JOINT_COUNT + j) * 10 + 3;
          let dot = 0;
          for (let c = 0; c < 4; c++) dot += src[bC + c] * src[b2 + c];
          const sgn = dot < 0 ? -1 : 1;
          for (let c = 0; c < 4; c++) q[c] += src[b2 + c] * sgn;
        }
        const ql = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        sampleData[bC] = q[0] / ql;
        sampleData[bC + 1] = q[1] / ql;
        sampleData[bC + 2] = q[2] / ql;
        sampleData[bC + 3] = q[3] / ql;
      }
    }
  }
  smoothComponent(10, 0, 2); // 平移/缩放 ±2 帧 (四元数分量单独 ±1)
  // 全局符号连续性扫尾: 相邻帧 dot<0 则翻转, 保证运行时 nlerp 不跨符号
  for (let j = 0; j < JOINT_COUNT; j++) {
    for (let f = 1; f < ANIM_FRAMES; f++) {
      const b0 = (f * JOINT_COUNT + j) * 10 + 3;
      const bPrev = ((f - 1) * JOINT_COUNT + j) * 10 + 3;
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += sampleData[b0 + c] * sampleData[bPrev + c];
      if (dot < 0) for (let c = 0; c < 4; c++) sampleData[b0 + c] = -sampleData[b0 + c];
    }
    // 环形收尾: 末帧对齐首帧
    const b0 = (0 * JOINT_COUNT + j) * 10 + 3;
    const bLast = ((ANIM_FRAMES - 1) * JOINT_COUNT + j) * 10 + 3;
    let dot = 0;
    for (let c = 0; c < 4; c++) dot += sampleData[b0 + c] * sampleData[bLast + c];
    if (dot < 0) for (let c = 0; c < 4; c++) sampleData[bLast + c] = -sampleData[bLast + c];
  }
  const OUT_ANIM = path.join(__dirname, '..', 'public', 'assets', 'phoenix-anim.bin');
  fs.writeFileSync(OUT_ANIM, Buffer.from(sampleData.buffer, 0, sampleData.length * 4));
  rig.anim = { frames: ANIM_FRAMES, duration: +duration.toFixed(4), file: 'assets/phoenix-anim.bin' };
  console.log('anim:', anim.name, 'duration', duration.toFixed(2) + 's',
    '→', ANIM_FRAMES + ' frames ×', JOINT_COUNT, 'joints =',
    (sampleData.length * 4 / 1024 / 1024).toFixed(2) + 'MB →', OUT_ANIM);
}
bakeAnimation();
fs.writeFileSync(OUT_RIG, JSON.stringify(rig));
console.log('rig updated with anim meta →', OUT_RIG);
console.log('chains:', JSON.stringify({
  leftWing: rig.chains.leftWing.length, rightWing: rig.chains.rightWing.length,
  tail: rig.chains.tail.length, hair: rig.chains.hair.length,
  legs: rig.chains.legs.length, jaw: rig.chains.jaw, head: rig.chains.head
}));
