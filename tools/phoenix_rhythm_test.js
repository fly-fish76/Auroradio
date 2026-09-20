// CDP 测试: 凤凰三种律动模式的 uniform 行为对比
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
    '--user-data-dir=' + process.env.TEMP + '/phoenix-rhythm-profile',
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

  // 就绪等待
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await evalJs(`typeof setPreset==='function' && typeof setPhoenixRhythmMode==='function'`);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('app not ready');
  await evalJs(`document.body.classList.remove('splash-active'); 'ok'`);
  await evalJs(`setPreset(9, {silent:true, skipTransition:true}); 'ok'`);
  let ok = false;
  for (let i = 0; i < 60; i++) {
    ok = await evalJs(`!!(window.phoenixParticleGroup && phoenixParticleGroup.geometry.attributes.aColor)`);
    if (ok) break;
    await evalJs(`document.body.classList.remove('splash-active'); 0`);
    await sleep(500);
  }
  if (!ok) throw new Error('phoenix layer missing');

  async function sample(tag) {
    const v = await evalJs(`(function(){
      var u = phoenixParticleGroup.material.uniforms;
      return { mode: fx.phoenixRhythmMode, bright: +u.uPhoenixBright.value.toFixed(2),
               beat: +u.uBeatBright.value.toFixed(3), sweepOn: u.uSweepOn.value,
               sweepPos: +u.uSweepPos.value.toFixed(3), opacity: +u.uOpacity.value.toFixed(2) };
    })()`);
    console.log(tag, JSON.stringify(v));
    return v;
  }

  // 模式1: beat (无音频, beat≈0; 手动注入鼓点脉冲验证增亮通道)
  await evalJs(`setPhoenixRhythmMode('beat', true); fx.brightness = 9.65; syncFxUniforms && syncFxUniforms(); 0`);
  await sleep(1200);
  const b1 = await sample('beat t0:');
  await evalJs(`window._bt = setInterval(function(){ phoenixBeatFlash = 0.9; }, 25); 0`);
  await sleep(300);
  const b2 = await sample('beat 注入鼓点:');
  await evalJs(`clearInterval(window._bt); 0`);
  await sleep(1000);
  const b3 = await sample('beat 释放1s:');

  // 模式2: breath (亮度应在数秒内漂移)
  await evalJs(`setPhoenixRhythmMode('breath', true); 0`);
  await sleep(800);
  const r1 = await sample('breath t0:');
  await sleep(2500);
  const r2 = await sample('breath t2.5s:');
  await sleep(2500);
  const r3 = await sample('breath t5s:');

  // 模式3: sweep (sweepOn=1, sweepPos 前进)
  await evalJs(`setPhoenixRhythmMode('sweep', true); 0`);
  await sleep(500);
  const s1 = await sample('sweep t0:');
  await sleep(1000);
  const s2 = await sample('sweep t1s:');
  await sleep(1500);
  const s3 = await sample('sweep t2.5s:');

  // 判定
  const breathMoved = Math.abs(r2.bright - r1.bright) > 0.3 || Math.abs(r3.bright - r2.bright) > 0.3 || Math.abs(r3.bright - r1.bright) > 0.3;
  const sweepMoved = s1.sweepPos !== s2.sweepPos || s2.sweepPos !== s3.sweepPos;
  console.log('---');
  console.log('beat: 注入鼓点后 uBeatBright>0 ?', b2.beat > 0.3, '| 1s后回落 ?', b3.beat < b2.beat);
  console.log('breath: 亮度漂移 ?', breathMoved, `(${r1.bright} → ${r2.bright} → ${r3.bright})`);
  console.log('sweep: 扫描推进 ?', sweepMoved, `(${s1.sweepPos} → ${s2.sweepPos} → ${s3.sweepPos})`);
  const pass = b2.beat > 0.3 && b3.beat < b2.beat && breathMoved && sweepMoved;
  console.log(pass ? 'ALL_MODES_OK' : 'SOME_MODES_FAIL');

  ws.close();
  chromeProc.kill();
  process.exit(pass ? 0 : 2);
}

main().catch(e => { console.error('TEST_FAIL:', e.message); process.exit(1); });
