import { app, BrowserWindow, session, nativeTheme, nativeImage } from 'electron';
import fs from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { once } from 'node:events';
import { auditPage } from './checks.mjs';
app.setActivationPolicy('prohibited');
app.disableHardwareAcceleration();
const job = JSON.parse(fs.readFileSync(process.argv.at(-1), 'utf8'));
app.setPath('userData', job.scratch + '/electron');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  app.dock?.hide();
  let blocked = 0;
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,done) => done(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const url = new URL(details.url);
    const allowed = url.origin === job.origin || ['data:', 'blob:'].includes(url.protocol);
    if (!allowed) blocked++;
    done({ cancel: !allowed });
  });
  const window = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 760, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, disableDialogs: true, offscreen: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== job.origin) event.preventDefault(); });
  const errors = [], shots = [], audits = [];
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(params.exceptionDetails)); });
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('render-process-gone', (_event, detail) => { process.stderr.write('Native renderer exited: ' + detail.reason); app.exit(1); });
  const evaluate = code => window.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
  const wait = async code => { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Render readiness deadline: ' + code + '\n' + await evaluate('document.documentElement.outerHTML') + '\n' + errors.join('\n')); };
  for (const width of [1000, 320]) for (const theme of ['light', 'dark']) for (const state of (job.surface ? [undefined, 'empty', 'loading', 'error'] : [undefined])) {
    errors.length = 0;
    nativeTheme.themeSource = theme; window.setContentSize(width, width === 320 ? 700 : 760);
    await window.loadURL(job.origin + (state ? "/?__gaia_state=" + state : ""));
    await window.webContents.debugger.sendCommand("Runtime.enable"); await evaluate(`localStorage.setItem('gaia.appearance', ${JSON.stringify(theme)})`);
    const loaded = once(window.webContents, "did-finish-load"); window.reload(); await loaded; await wait(`!!document.querySelector('[aria-label="Account settings"]')`);
    if (job.scenario === 'setups') {
      await evaluate(`document.querySelector('[aria-label="Account settings"]').click()`);
      await wait(`!!document.getElementById('plan-title')`);
      if (width === 320) { await evaluate(`document.querySelector('.settings-section-trigger').click()`); await wait(`!!document.querySelector('[role="option"]')`); }
      await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(width === 320 ? '[role="option"]' : '.settings-index button')})).find(e=>e.textContent.trim()==='Setups').click()`);
      await wait(`!!document.getElementById('setups-title')`);
    }
    const targetCode = step => `(() => {const step=${JSON.stringify(step)};const roles={button:'button,[role="button"]',textbox:'textarea,input:not([type]),input[type="text"],[role="textbox"]',link:'a[href],[role="link"]',heading:'h1,h2,h3,h4,h5,h6,[role="heading"]'};return [...document.querySelectorAll(roles[step.role]||'[role="'+step.role+'"]')].find(el=>{const r=el.getBoundingClientRect();const name=el.getAttribute('aria-label')||(el.getAttribute('aria-labelledby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||el.textContent.trim();return r.width>0&&r.height>0&&name===step.name;});})()`;
    for (const step of job.surface?.steps ?? []) {
      if (step.kind === 'press') { window.webContents.sendInputEvent({type:'keyDown',keyCode:step.key}); window.webContents.sendInputEvent({type:'keyUp',keyCode:step.key}); continue; }
      const target = targetCode(step); await wait('!!' + target);
      if (step.kind === 'click') await evaluate(target + '.click()');
      if (step.kind === 'type') await evaluate(`(()=>{const el=${target};Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(step.text)});el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));})()`);
    }
    const ready = {answer:'A calmer week',proposal:'Use this setup',failed:'Try again',setups:'My sessions'}[job.scenario]; if (ready) await wait('document.body.innerText.includes(' + JSON.stringify(ready) + ')');
    await evaluate(`document.fonts.ready`); await new Promise(resolve => setTimeout(resolve, 350));
    await evaluate(`for (const animation of document.getAnimations()) { if (animation.effect.getComputedTiming().iterations === Infinity) animation.cancel(); else animation.finish(); }`);
    if (window.isVisible() || window.isFocused()) throw Error('Renderer must remain hidden and unfocused');
    if (await evaluate(`document.documentElement.classList.contains('dark')`) !== (theme === 'dark')) throw Error('Theme did not render: ' + theme);
    if (job.scenario === 'setups' && !await evaluate(`!!document.getElementById('setups-title')`)) throw Error('Settings capture lost its selected pane');
    if (!state) {
      const file = `${job.scenario}-${width}-${theme}.png`;
      fs.writeFileSync(job.scratch + '/' + file, (await window.webContents.capturePage(undefined, {stayHidden:true})).toPNG());
      const picture = nativeImage.createFromPath(job.scratch + '/' + file);
      fs.writeFileSync(job.scratch + '/' + file.replace('.png', '.jpg'), picture.toJPEG(75));
      let changed = 0;
      if (job.compare) {
        const previous = nativeImage.createFromPath(job.scratch + '/before/' + file).toBitmap(), current = picture.toBitmap();
        if (previous.length !== current.length) throw Error('Preview image dimensions differ');
        const masks = await evaluate(`Array.from(document.querySelectorAll('[data-preview-surface]')).map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})`);
        for (let pixel = 0; pixel < current.length; pixel += 4) if (!masks.some(r => (pixel/4)%picture.getSize().width >= r.x && (pixel/4)%picture.getSize().width < r.right && Math.floor(pixel/4/picture.getSize().width) >= r.y && Math.floor(pixel/4/picture.getSize().width) < r.bottom) && [0,1,2].some(channel => Math.abs(previous[pixel+channel]-current[pixel+channel]) > 0)) changed++;
      }
      shots.push({ file, width, theme, changed: changed / (width * (width === 320 ? 700 : 760)) });
      if (window.isVisible() || window.isFocused()) throw Error("Capture must remain hidden and unfocused");
    }
    await evaluate(fs.readFileSync(job.axe, 'utf8'));
    const report = await evaluate('(' + auditPage.toString() + ')(' + JSON.stringify(state) + ',' + JSON.stringify(job.scenario) + ')');
    if (report.failures.length || errors.length) throw Error('apps/web, ' + job.scenario + ', ' + width + ', ' + theme + ', ' + (state || 'filled') + ':\n' + [...report.failures,...errors].join('\n'));
    audits.push({width,theme,state:state||'filled',...report});
  }
  const before = blocked;
  await session.defaultSession.fetch('https://example.com/gaia-render-denial').then(() => { throw Error('External request escaped'); }, () => {});
  if (blocked <= before) throw Error('Session request denial was not proven');
  window.destroy(); process.stdout.write(JSON.stringify({ shots, audits, errors, externalBlocked: true, hidden: true }) + '\n'); app.quit();
}).catch(error => { process.stderr.write(String(error.stack)); app.exit(1); });
