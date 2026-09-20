// CDP 冒烟测试: 凤凰封面模式 aColor 重映射是否生效
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3210;
const { execFile } = require('child_process');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT + 1}/json`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.url.includes(`localhost:${PORT}`));
      if (page) return page;
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  throw new Error('no page target');
}

async function main() {
  // 1. 启动无头 Chrome
  const chromeProc = execFile(CHROME, [
    '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT + 1}`, '--window-size=1280,800',
    '--user-data-dir=' + process.env.TEMP + '/phoenix-test-profile',
    `http://localhost:${PORT}`
  ]);

  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  function send(method, params) {
    return new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000
    });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  // 2. 进入应用 (跳过 splash), 等脚本就绪
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await evalJs(`typeof setPreset==='function' && typeof syncPhoenixParticleColors==='function' && typeof fx==='object'`);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('app scripts not ready');
  await evalJs(`document.body.classList.remove('splash-active'); 'ok'`);

  // 3. 切到凤凰预设并等待资产加载
  await evalJs(`(function(){ setPreset(9, {silent:true, skipTransition:true}); return fx.preset; })()`);
  let group = null;
  for (let i = 0; i < 60; i++) {
    group = await evalJs(`!!(window.phoenixParticleGroup && window.phoenixParticleGroup.geometry && phoenixParticleGroup.geometry.attributes.aColor)`);
    if (group) break;
    await sleep(500);
  }
  if (!group) throw new Error('phoenix layer not created (assets failed?)');

  // 4. 注入测试封面调色板 (蓝绿系, 与火羽色差异明显) 并切封面模式
  const result = await evalJs(`(function(){
    stageLyrics.coverPalette = {
      rawDark:'rgb(10,15,46)', secondary:'rgb(31,63,216)', primary:'rgb(47,95,232)', rawWarm:'rgb(24,200,176)',
      rawCool:'rgb(16,80,192)', rawAccent:'rgb(48,232,96)', highlight:'rgb(168,255,176)', rawLight:'rgb(216,255,224)'
    };
    fx.phoenixColorMode = 'cover';
    syncPhoenixParticleColors();
    var attr = phoenixParticleGroup.geometry.attributes.aColor;
    var arr = attr.array;
    var diff = 0, n = Math.min(20, arr.length);
    for (var i = 0; i < n; i++) if (Math.abs(arr[i] - phoenixDefaultColors[i]) > 0.01) diff++;
    var lum = function(r,g,b){return 0.299*r+0.587*g+0.114*b;};
    var lo=1,hi=0,avg=[0,0,0],cnt=arr.length/3;
    for (var i=0;i<arr.length;i+=3){
      var l=lum(arr[i],arr[i+1],arr[i+2]); lo=Math.min(lo,l); hi=Math.max(hi,l);
      avg[0]+=arr[i]/cnt; avg[1]+=arr[i+1]/cnt; avg[2]+=arr[i+2]/cnt;
    }
    var stopsInfo = null;
    try { stopsInfo = phoenixCollectCoverStops(); } catch(e) { stopsInfo = 'ERR:'+e.message; }
    return {
      mode: fx.phoenixColorMode,
      sig: phoenixCoverRemapSig.slice(0, 80),
      firstChanged: diff,
      defaultFirst3: [phoenixDefaultColors[0].toFixed(3), phoenixDefaultColors[1].toFixed(3), phoenixDefaultColors[2].toFixed(3)],
      remapFirst3: [arr[0].toFixed(3), arr[1].toFixed(3), arr[2].toFixed(3)],
      lumRange: [lo.toFixed(3), hi.toFixed(3)],
      avgRGB: avg.map(function(v){return v.toFixed(3);}),
      stopsCount: Array.isArray(stopsInfo) ? stopsInfo.length : stopsInfo,
      uSolidAmt: phoenixParticleGroup.material.uniforms.uSolidAmt.value
    };
  })()`);
  console.log(JSON.stringify(result, null, 2));

  // 5. 切回默认, 验证恢复
  const back = await evalJs(`(function(){
    fx.phoenixColorMode = 'default';
    syncPhoenixParticleColors();
    var arr = phoenixParticleGroup.geometry.attributes.aColor.array;
    var same = true;
    for (var i = 0; i < arr.length; i++) if (Math.abs(arr[i] - phoenixDefaultColors[i]) > 0.001) { same = false; break; }
    return { restoredToDefault: same, sig: phoenixCoverRemapSig };
  })()`);
  console.log('restore:', JSON.stringify(back));

  ws.close();
  chromeProc.kill();
  process.exit(0);
}

main().catch(e => { console.error('TEST_FAIL:', e.message); process.exit(1); });
