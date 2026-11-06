import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createAuth } from '../../../apps/server/auth.ts';
import { createPi, type ChatAdapter } from '../../../apps/server/pi.ts';
import { createChatServer, openDatabase } from '../../../apps/server/server.ts';
import { webResource } from '../../../core/web.ts';
import { Experience, ExperienceState } from '../../../packages/protocol/experiences.ts';
import { Thread } from '../../../packages/protocol/index.ts';

process.umask(0o077);
const round = process.argv[process.argv.indexOf('--round') + 1];
assert(process.argv.includes('--round') && /^[a-zA-Z0-9_-]+$/.test(round), 'Use --round <n>');
const root = process.cwd();
const output = resolve('data/verification/design-pass/rounds', round);
assert(!existsSync(join(output, 'manifest.json')), 'Round already complete. Choose a fresh round name.');
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightPath = process.env.GAIA_CAPTURE_PLAYWRIGHT ?? '/Users/avi/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
const { _electron } = await import(playwrightPath);
const head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const status = execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim();
execFileSync('npm', ['run', 'build'], {stdio:'pipe'});
const origin = 'http://127.0.0.1:4337';
const answer = '## A calmer week\n\nKeep the plan small enough to use every day. Start with the commitments already in your calendar.\n\n### Three useful steps\n\n1. Choose one important task for the morning.\n2. Leave space for a walk and lunch.\n3. Review what changed on Friday.\n\n### A small example\n\n```typescript\nconst week = { focus: "Finish the draft", breaks: true };\nconsole.log(week.focus);\n```\n\n### Further reading\n\nThe [MDN JavaScript guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) explains the example. The [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) covers the types.\n\nYou can change the plan as your week changes.';
const prompt = 'Help me make a simple plan for the week, with a code example and sources.';
const descriptions = {
 J1:'First run offers matching buttons to continue with a ChatGPT or Claude plan.',
 J2:'Original chat is empty and ready for a first message.',
 J3:'Original chat is waiting for a scripted reply with its quiet progress indicator.',
 J4:'Original chat shows a settled answer with headings, a numbered list, a code block and linked sources.',
 J5:'A reply offers a Bots setup in an inline proposal card.',
 J6:'The Bots setup shows its sidebar and the selected Home conversation.',
 J7channels:'The Channels setup shows its topic sidebar and selected conversation.',
 J7sessions:'The Sessions setup shows separate conversations and the selected session.',
 J8account:'Account settings show both plan rows, Appearance and the About you section.',
 J8setups:'The setups list shows the available Bots, Channels and Sessions setups.',
 J9:'The model and effort menu is open above the Original chat composer.',
 J10:'Original chat shows a failed reply and its recovery controls.',
 J11:'The composer holds a landscape image attachment and an unsent typed draft.'
};
const files: object[] = [];
const limits = ['Original chat has no tool activity in its protocol, so J3 shows actual quiet progress only.', 'J4 citations are normal Markdown source links because Original chat does not expose structured citation metadata.', 'Captures use the real Electron renderer through CDP; native macOS title bar buttons are outside the renderer PNG.'];
for (const key of Object.keys(descriptions)) {
 const dir = await mkdtemp(resolve('data/verification/design-pass/qa-'));
 const db = await openDatabase(dir);
 const auth = createAuth(db);
 const catalogue = openaiCodexProvider().getModels();
 const fixtureModels = ['gpt-6.1-sol', 'gpt-6.1-terra'].map(id => {
  const model = catalogue.find(model => model.id === id);
  assert(model, `Missing Pi catalogue model: ${id}`);
  return model;
 });
 const faux = fauxProvider({provider:'openai-codex',models:fixtureModels, tokensPerSecond:100000});
 for (const model of faux.models) model.thinkingLevelMap = fixtureModels.find(entry => entry.id === model.id)?.thinkingLevelMap;
 auth.models.setProvider(faux.provider);
 auth.planAvailability.connectedProviders = () => new Set(key === 'J1' ? [] : ['openai-codex']);
 const pi = await createPi(join(dir,'pi.sqlite'),auth,[],{}, {experiencesEnabled:true});
 const seed = Thread.parse({version:1,id:'local',messages: ['J4','J5','J10'].includes(key) ? [
  {id:'user-baseline',role:'user',text:key==='J5'?'Can you give me separate Bots for home, study and work?':prompt,createdAt:'2026-11-05T00:00:00.000Z'},
  ...(key==='J10'?[]:[{id:'answer-baseline',role:'assistant',text:key==='J5'?'Here is a setup with a Bot for each part of your day. You can review it below.':answer,createdAt:'2026-11-05T00:00:01.000Z'}])
 ]:[],run:key==='J10'?{kind:'error',message:'The reply could not finish. Try again when ready.'}:{kind:'idle'}});
 db.exec('CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
 db.prepare('INSERT OR REPLACE INTO chat VALUES (1,?)').run(JSON.stringify(seed));
 const adapter: ChatAdapter = {...pi, async run({signal}) { await new Promise<void>(done=>{if(signal.aborted)done();else signal.addEventListener('abort',()=>done(),{once:true});}); }};
 const app = createChatServer({db, adapter, origins:[origin],auth:{status:()=>key==='J1'?{kind:'disconnected',message:'Connect your plan to begin.'}:{kind:'connected',model:'gpt-6.1-sol'},connect(){},reply(){},close:()=>auth.close()}});
 const handlers = app.server.listeners('request');
 app.server.removeAllListeners('request');
 app.server.on('request', async(req,res)=>{
  const path = new URL(req.url??'/',origin).pathname;
  if(req.method==='GET'&&!path.startsWith('/api/')&&path!=='/healthz') {
   const resource = await webResource(path,{data:dir,release:head,directory:root});
   res.writeHead(resource.status,{'Content-Type':resource.type,'Cache-Control':'no-store'});res.end(resource.body);return;
  }
  for(const handler of handlers)handler.call(app.server,req,res);
 });
 await new Promise<void>((done,reject)=>{app.server.once('error',reject);app.server.listen(4337,'127.0.0.1',done);});
 const api = async(path:string, input?:unknown,method=input===undefined?'GET':'POST')=>{
  const response=await fetch(origin+'/api/v1/'+path,{method,headers:{'Content-Type':'application/json',Origin:origin},...(input===undefined?{}:{body:JSON.stringify(input)})});
  assert(response.ok,await response.clone().text());return response.json();
 };
 if(key==='J5')await pi.experiences!.create({requestId:'00000000-0000-4000-8000-000000000005',plan:{layout:'bots',title:'Everyday Bots',assistantName:'Gaia',purpose:'Keep home, study and work organised.',scopes:[{label:'Home',purpose:'Plan the day and coordinate your Bots.',avatar:'bot-01'},{label:'Study',purpose:'Make time for learning.',avatar:'bot-02'},{label:'Work',purpose:'Prepare clear reports.',avatar:'bot-03'}]}},{source:{kind:'conversation',conversationId:'original'},answerMessageId:'answer-baseline'});
 if(['J6','J7channels','J7sessions','J8setups'].includes(key)){
  for(const layout of (key==='J8setups'?['bots','channels','sessions']:[key==='J6'?'bots':key==='J7channels'?'channels':'sessions'])){
   const proposal=Experience.parse(await api('experiences',{requestId:randomUUID(),plan:{layout,title:layout==='bots'?'Everyday Bots':layout==='channels'?'Shared workspace':'My sessions',assistantName:'Gaia',purpose:'A simple place for everyday work.',scopes:[{label:layout==='sessions'?'Weekly plan':'Home',purpose:'Plan the day and keep track of what matters.',avatar:'bot-01'},{label:layout==='channels'?'Reading':'Study',purpose:'Explore ideas and make time for learning.',avatar:'bot-02'},{label:'Work',purpose:'Prepare clear reports.',avatar:'bot-03'}]}}));
   const state=ExperienceState.parse(await api(`experiences/${proposal.id}/confirm`,{revision:proposal.revision}));
   faux.setResponses([fauxAssistantMessage('We can start with one useful thing today. What would you like to focus on?')]);
   const scope=state.scopes[0];
   await api(`experiences/${proposal.id}/scopes/${scope.id}/messages`,{requestId:randomUUID(),text:'Help me plan my day.'});
   for(let i=0;i<100;i++){const s=ExperienceState.parse(await api(`experiences/${proposal.id}/state`));if(s.jobs.every(j=>j.state.kind==='completed'))break;await new Promise(r=>setTimeout(r,30));}
   if(key!=='J8setups')await api('experiences/main',{profileId:proposal.id},'PUT');
  }
 }
 const env={...process.env,GAIA_DESKTOP_URL:origin};delete env.ELECTRON_RUN_AS_NODE;
 const bootstrap = join(dir, 'background.cjs');
 await writeFile(bootstrap, `
 const { app, BrowserWindow } = require('electron');
 app.setActivationPolicy('prohibited');
 BrowserWindow.prototype.show = function () {};
 BrowserWindow.prototype.showInactive = function () {};
 BrowserWindow.prototype.focus = function () {};
 app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.setPosition(-10000, -10000);
 });
 app.whenReady().then(() => app.dock?.hide());
 import(${JSON.stringify('file://' + resolve('dist/desktop/main.js'))});
 `);
 const electron=await _electron.launch({executablePath:require('electron'),args:[bootstrap,`--user-data-dir=${join(dir,'electron')}`],env});
 try {
  const page=await electron.firstWindow();
  await page.waitForSelector(key==='J1'?'#welcome-title':'[aria-label="Account settings"]');
  await electron.evaluate(({app}) => app.dock?.hide());
  const windows = await electron.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w => ({visible:w.isVisible(),focused:w.isFocused(),backgroundThrottling:w.webContents.getBackgroundThrottling()})));
  assert(windows.every(w => !w.visible && !w.focused && !w.backgroundThrottling), 'Capture windows must stay hidden and unfocused');
  await writeFile(join(output,`${key}-native-windows.json`),JSON.stringify(windows));
  const variants=['J2','J4','J5','J6','J8account','J8setups','J9','J10','J11'].includes(key)?[[1000,760,'light'],[1000,760,'dark'],[320,700,'light'],[320,700,'dark']]:[[1000,760,'light']];
  for(const [width,height,theme] of variants){
   await electron.evaluate(({BrowserWindow,nativeTheme},v)=>{nativeTheme.themeSource=v.theme;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(v.width,v.height);},{width,height,theme});
   await page.evaluate(t=>localStorage.setItem('gaia.appearance',t),theme);
   await page.reload();await page.waitForSelector(key==='J1'?'#welcome-title':'[aria-label="Account settings"]');
   // Reset overlays before the scenario opens its intentional UI.
   await page.keyboard.press('Escape');
   await page.locator('.model-popover, .model-sheet, [role="menu"]').first().waitFor({state:'hidden'});
   assert.equal(await page.getByRole('dialog').count(),0,'Every variant must start without a dialog');
   assert.equal(await page.getByRole('menu').count(),0,'Every variant must start without a menu');
   if(key==='J3'){
    await api('messages',{requestId:randomUUID(),text:'Help me check the weekly plan.'});
    await page.getByRole('button',{name:'Stop reply',exact:true}).waitFor();
   }
   if(key==='J8account'||key==='J8setups')await page.getByRole('button',{name:'Account settings',exact:true}).click();
   if(key==='J8account'||key==='J8setups') {
    assert.equal(await page.locator('.app-bar').innerText(),'Settings');
    await page.getByRole('button',{name:'Close settings',exact:true}).waitFor();
    if(width===320)await page.getByRole('button',{name:/Settings section/}).waitFor();
    else await page.getByRole('navigation',{name:'Settings sections',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Skip',exact:true}).count(),0);
   }
   if(key==='J8setups'){
    if(width===320){await page.getByRole('button',{name:/Settings section/}).click();await page.getByRole('option',{name:'Setups',exact:true}).click();}
    else await page.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'Setups',exact:true}).click();
    await page.getByRole('heading',{name:'Setups',exact:true}).waitFor();
    assert(!await page.locator('.setup-settings').innerText().then(t=>t.includes('Created')));
   }
   if(key==='J9'){
    await page.getByRole('button',{name:/Model and reasoning effort/}).click();
    await page.getByRole('dialog',{name:'Model and reasoning effort',exact:true}).waitFor();
   }
   if(key==='J11'){
    await page.locator('input[type=file]').setInputFiles(resolve('data/verification/design-pass/landscape.png'));
    await page.getByRole('textbox',{name:'Message Gaia',exact:true}).fill('Can you help me describe this landscape?');
    await page.getByRole('button',{name:/Remove/}).waitFor();
   }
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
   if(['J6','J7channels','J7sessions'].includes(key)) await page.getByText('We can start with one useful thing today. What would you like to focus on?',{exact:true}).waitFor();
   if(key==='J5') await page.getByRole('button',{name:'Use this setup',exact:true}).waitFor();
   await page.waitForTimeout(500);
   if(key!=='J9') {
    assert.equal(await page.getByRole('dialog',{name:'Model and reasoning effort',exact:true}).count(),0,`${key} must not contain the model picker`);
    assert.equal(await page.getByRole('menu').count(),0,`${key} must not contain an unintended menu`);
   }
   const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dark:document.documentElement.classList.contains('dark'),text:document.body.innerText}));
   assert.equal(viewport.width,width);assert.equal(viewport.height,height);assert.equal(viewport.dark,theme==='dark');
   const file=`${key}-${width}-${theme}.png`;
   const bytes=await page.screenshot({path:join(output,file),animations:'disabled',caret:'hide'});
   files.push({file,description:descriptions[key],width,height,theme,sha256:createHash('sha256').update(bytes).digest('hex'),stateText:viewport.text});
   if(key==='J9') {
    assert.equal(await page.locator('.model-facts').count(),0,'Identical facts must be hidden');
    const cells=page.locator('.effort-cell');
    const selected=page.locator('.effort-cell[data-selected]');
    assert.equal(await selected.count(),1);
    const selectedColour=await selected.evaluate(el=>getComputedStyle(el).backgroundColor);
    for(let i=0;i<await cells.count();i++) {
     await cells.nth(i).hover();
     await page.waitForTimeout(180);
     const fills=await cells.evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundColor));
     assert.equal(fills.filter(fill=>fill===selectedColour).length,1,'Hover must not look selected');
     await cells.nth(i).locator('input').focus();
     assert.equal(await selected.count(),1,'Focus alone must not select another effort');
    }
    const bounds=await cells.evaluateAll(els=>els.map(el=>({scroll:el.scrollWidth,width:el.clientWidth})));
    assert(bounds.every(b=>b.scroll<=b.width),'Effort labels must fit');
    await writeFile(join(output,`J9-${width}-${theme}-selection.json`),JSON.stringify({oneSelected:true,hoverAndFocus:true,labelsFit:true,identicalFactsHidden:true}));
   }
   if(key==='J9') {
    const picker=page.getByRole('dialog',{name:'Model and reasoning effort',exact:true});
    const trigger=page.getByRole('button',{name:/Model and reasoning effort/});
    await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    await trigger.click();await picker.waitFor();
    await page.mouse.click(10,80);await picker.waitFor({state:'hidden'});
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    await trigger.click();await picker.waitFor();await page.reload();await picker.waitFor({state:'hidden'});
    await writeFile(join(output,`J9-${width}-${theme}-dismissal.json`),JSON.stringify({escape:true,outside:true,reload:true}));
   }
   console.log(file);
  }
 }finally{await electron.close();await app.close();await rm(dir,{recursive:true,force:true});}
}
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), head, 'HEAD changed during capture');
assert.equal(execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim(), status, 'Working tree changed during capture');
await writeFile(join(output,'manifest.json'),JSON.stringify({captureVersion:2,round,head,dirty:!!status,gitStatus:status,origin,renderer:'Real Electron production main and built web assets, Playwright Electron CDP',limits,files},null,2)+'\n');
console.log(`Captured ${files.length} screenshots in ${output}`);
