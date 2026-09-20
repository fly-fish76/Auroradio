// CDP 测试: 启动不自动打开 Home + goHome 手动可用 + 呼吸范围 0~10
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
    '--user-data-dir=' + process.env.TEMP + '/boot-home-profile',
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
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await evalJs(`typeof finishSplashReveal==='function' && typeof goHome==='function'`);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error('app not ready');
  // 模拟 splash 结束后的揭示流程
  await evalJs(`document.body.classList.remove('splash-active'); finishSplashReveal(true, {reason:'test'}); 0`);
  await sleep(1200);
  const afterBoot = await evalJs(`document.body.classList.contains('empty-home-active')`);
  console.log('启动后 home 自动打开?', afterBoot, afterBoot === false ? '✓ 已取消' : '✗ 仍会打开');
  // 手动 goHome 仍可用
  await evalJs(`goHome(); 0`);
  await sleep(600);
  const manualOpen = await evalJs(`document.body.classList.contains('empty-home-active')`);
  await evalJs(`goHome(); 0`);
  await sleep(600);
  const manualClose = await evalJs(`document.body.classList.contains('empty-home-active')`);
  console.log('手动 goHome 打开?', manualOpen, '| 再次 goHome 关闭?', manualClose === false);
  // 呼吸范围 0~10
  await evalJs(`setPreset(9, {silent:true, skipTransition:true}); setPhoenixRhythmMode('breath', true); 0`);
  let inRange = true, seen = [];
  for (let i = 0; i < 6; i++) {
    await sleep(1800);
    const v = await evalJs(`+phoenixParticleGroup.material.uniforms.uPhoenixBright.value.toFixed(2)`);
    seen.push(v);
    if (v > 10.01) inRange = false;
  }
  console.log('呼吸亮度采样:', seen.join(' → '), '| 全部 ≤10 ?', inRange);
  const pass = afterBoot === false && manualOpen === true && manualClose === false && inRange;
  console.log(pass ? 'ALL_OK' : 'SOME_FAIL');
  ws.close();
  chromeProc.kill();
  process.exit(pass ? 0 : 2);
}
main().catch(e => { console.error('TEST_FAIL:', e.message); process.exit(1); });
