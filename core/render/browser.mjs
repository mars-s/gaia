import { app, BrowserWindow, session, nativeTheme } from 'electron';
import fs from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
app.setActivationPolicy('prohibited');
app.disableHardwareAcceleration();
const job = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
app.setPath('userData', job.scratch + '/electron');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  app.dock?.hide();
  let blocked = 0;
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const url = new URL(details.url);
    const allowed = url.origin === job.origin || ['data:', 'blob:'].includes(url.protocol);
    if (!allowed) blocked++;
    done({ cancel: !allowed });
  });
  const window = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 760, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== job.origin) event.preventDefault(); });
  const errors = [], shots = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('render-process-gone', (_event, detail) => { throw Error('Renderer exited: ' + detail.reason); });
  const evaluate = code => window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
  const wait = async code => { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Render readiness deadline: ' + code + '\n' + await evaluate('document.documentElement.outerHTML') + '\n' + errors.join('\n')); };
  for (const width of [1000, 320]) for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme; window.setContentSize(width, width === 320 ? 700 : 760);
    await window.loadURL(job.origin); await evaluate(`localStorage.setItem('gaia.appearance', ${JSON.stringify(theme)})`);
    await window.reload(); await wait(`!!document.querySelector('[aria-label="Account settings"]')`);
    if (job.scenario === 'setups') {
      await evaluate(`document.querySelector('[aria-label="Account settings"]').click()`);
      await wait(`!!document.getElementById('plan-title')`);
      if (width === 320) { await evaluate(`document.querySelector('.settings-section-trigger').click()`); await wait(`!!document.querySelector('[role="option"]')`); }
      await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(width === 320 ? '[role="option"]' : '.settings-index button')})).find(e=>e.textContent.trim()==='Setups').click()`);
      await wait(`!!document.getElementById('setups-title')`);
    }
    await evaluate(`document.fonts.ready`); await new Promise(resolve => setTimeout(resolve, 350));
    if (window.isVisible() || window.isFocused()) throw Error('Renderer must remain hidden and unfocused');
    const file = `${job.scenario}-${width}-${theme}.png`;
    fs.writeFileSync(job.scratch + '/' + file, (await window.webContents.capturePage()).toPNG());
    shots.push({ file, width, theme });
  }
  const before = blocked;
  await session.defaultSession.fetch('https://example.com/gaia-render-denial').then(() => { throw Error('External request escaped'); }, () => {});
  if (blocked <= before) throw Error('Session request denial was not proven');
  window.destroy(); process.stdout.write(JSON.stringify({ shots, errors, externalBlocked: true, hidden: true }) + '\n'); app.quit();
}).catch(error => { process.stderr.write(String(error.stack)); app.exit(1); });
