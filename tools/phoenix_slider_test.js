// CDP 测试: 粒子亮度滑杆链路 (输入事件 → fx.brightness → 各材质 uniform)
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
    } catch (e) { }
    await sleep(500);
  }
  throw new Error('no page target');
}

async function main() {
  const chromeProc = execFile(CHROME, [
    '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
    `--remote-debugging-port=${PORT + 1}`, '--window-size=1280,800',
    '--user-data-dir=' + process.env.TEMP + '/phoenix-slider-profile',
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
  async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  function send(method, params) {
    return new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  function dragSlider(value) {
    return evalJs(`(function(){
      var el = document.getElementById('fx-bright');
      if (!el) return 'NO_SLIDER';
      el.value = ${value};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
  }
  async function readState() {
    return evalJs(`(function(){
      var u = window.phoenixParticleGroup && phoenixParticleGroup.material.uniforms;
      return {
        fxBright: fx.brightness,
        phoenixBright: u ? +u.uPhoenixBright.value.toFixed(2) : null,
        sharedBright: (typeof uniforms !== 'undefined' && uniforms.uBright) ? +uniforms.uBright.value.toFixed(2) : null,
        rhythm: fx.phoenixRhythmMode
      };
    })()`);
  }

  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await evalJs(`typeof setPreset==='function' && typeof setPhoenixRhythmMode==='function'`);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('app not ready');
  await evalJs(`document.body.classList.remove('splash-active'); setPreset(9, {silent:true, skipTransition:true}); 0`);
  let ok = false;
  for (let i = 0; i < 60; i++) {
    ok = await evalJs(`!!(window.phoenixParticleGroup && phoenixParticleGroup.geometry.attributes.aColor)`);
    if (ok) break;
    await evalJs(`document.body.classList.remove('splash-active'); 0`);
    await sleep(500);
  }
  if (!ok) throw new Error('phoenix layer missing');

  console.log('--- beat 模式下滑杆链路 ---');
  await evalJs(`setPhoenixRhythmMode('beat', true); 0`);
  await sleep(600);
  console.log('初始:', JSON.stringify(await readState()));
  console.log('拖到 15:', await dragSlider(15));
  await sleep(500);
  console.log('结果:', JSON.stringify(await readState()));
  console.log('拖到 2:', await dragSlider(2));
  await sleep(500);
  console.log('结果:', JSON.stringify(await readState()));

  console.log('--- breath 模式下滑杆 (预期: fx 变但 uPhoenixBright 不跟) ---');
  await evalJs(`setPhoenixRhythmMode('breath', true); 0`);
  await sleep(400);
  console.log('拖到 18:', await dragSlider(18));
  await sleep(400);
  console.log('结果:', JSON.stringify(await readState()));

  console.log('--- 切回 beat 后滑杆恢复控制? ---');
  await evalJs(`setPhoenixRhythmMode('beat', true); 0`);
  await sleep(400);
  console.log('结果:', JSON.stringify(await readState()));

  ws.close();
  chromeProc.kill();
  process.exit(0);
}

main().catch(e => { console.error('TEST_FAIL:', e.message); process.exit(1); });
