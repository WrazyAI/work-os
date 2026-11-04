#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createOttoFilmApi,speechLines,FILM_NOW} from './otto-fixtures.mjs';
import {ottoParts} from './otto-story.mjs';
import {fingerprintBuild} from './otto-provenance.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_PATH||'/home/maigreeks/projects/work-os/node_modules/playwright');
const dry=process.argv.includes('--preflight'),serve=process.argv.includes('--serve');
const only=process.argv.includes('--part')?process.argv[process.argv.indexOf('--part')+1]:null;
const appRoot=resolve(process.env.FILM_APP||'desktop/work-os-companion/dist-otto-film');
const out=resolve(process.env.FILM_OUT||'/tmp/opencode/otto-film',dry?'preflight':'capture');mkdirSync(out,{recursive:true});
const seed=JSON.parse(readFileSync(process.env.FILM_SEED||'/tmp/opencode/otto-seed.json','utf8'));
const buildFingerprint=fingerprintBuild(appRoot);
let api=createOttoFilmApi({phase:'workday',seed});
let evidence,sceneEvidence,recordingStart=0,activeSpeech=null;
const server=createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://127.0.0.1:1455');
  if(u.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   evidence?.fixtureRequests.push({method:req.method,path:req.url});
   if(u.pathname==='/api/work-os/voice/recap'){
    res.writeHead(200,{'Content-Type':'audio/mpeg','x-work-os-recap-lines':encodeURIComponent(JSON.stringify(speechLines)),'x-work-os-recap-revision':'1','x-work-os-recap-stale':'0'});
    res.end(readFileSync(resolve(appRoot,'voices/warm.mp3')));return;
   }
   const result=api.handle(req.method,req.url,body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
  }
  const name=resolve(appRoot,'.'+decodeURIComponent(u.pathname));if(!name.startsWith(appRoot+'/')&&name!==appRoot){res.writeHead(403).end();return;}
  const file=extname(name)?name:resolve(appRoot,'index.html');
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.wasm':'application/wasm','.html':'text/html','.mp3':'audio/mpeg'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 }catch(error){evidence?.errors.push(error.message);res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(1455,'127.0.0.1',ok)});
if(serve){console.log('Otto offline film fixture: http://127.0.0.1:1455/?token=demonstration-only');await new Promise(()=>{});}
let browser,xvfb,encoder,encoderExit;
try{
 if(!dry){xvfb=spawn('Xvfb',[':177','-screen','0','1536x1100x24','-nolisten','tcp','-noreset'],{stdio:['ignore','ignore','inherit']});await new Promise((ok,no)=>{xvfb.once('error',no);setTimeout(ok,600)});}
 browser=await chromium.launch({headless:dry,env:{...process.env,DISPLAY:':177'},args:['--disable-dev-shm-usage','--no-sandbox','--kiosk','--window-position=0,0','--window-size=1440,900','--force-device-scale-factor=1','--autoplay-policy=no-user-gesture-required']});
 for(const part of ottoParts.filter(p=>!only||p.id===only)){
  const dir=resolve(out,part.id);mkdirSync(dir,{recursive:true});
  evidence={id:part.id,title:part.title,preflight:dry,buildFingerprint,fixtureRequests:[],backendCalls:[],errors:[],scenes:[]};
  try{
   for(const scene of part.scenes){
    recordingStart=0;activeSpeech=null;
    api=createOttoFilmApi({phase:part.phase,seed});
    sceneEvidence={surface:scene.surface,actions:[],speech:[],alternate:!!scene.alternate};evidence.scenes.push(sceneEvidence);
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
    await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:1455/')){evidence.backendCalls.push(url);return route.abort();}return route.continue();});
    const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',e=>evidence.errors.push(e.message));
    await context.addInitScript(({now,seedNextSteps})=>{
     const ActualDate=Date;const base=performance.now();class FilmDate extends ActualDate{constructor(...args){super(...(args.length?args:[Date.parse(now)+performance.now()-base]))}static now(){return Date.parse(now)+performance.now()-base}}window.Date=FilmDate;
     // The native vault is supplied by a filming-build-only adapter. It seeds
     // a genuine stored conversation card, not a product DOM or approval state.
     if(seedNextSteps)localStorage.setItem('otto-film:seed-chat',JSON.stringify([{id:'next-steps-film-recap',role:'assistant',text:'Recap confirmed — here is what could come next:',createdAt:now,nextSteps:seedNextSteps}]));
     const originalPlay=HTMLMediaElement.prototype.play;
     HTMLMediaElement.prototype.play=function(){if(!this.dataset.filmObserved){this.dataset.filmObserved='1';for(const name of ['playing','pause','ended'])this.addEventListener(name,()=>{if(this.duration>1){window.__filmAudioPlaying=name==='playing';void window.filmMediaEvent({event:name,at:performance.timeOrigin+performance.now(),currentTime:this.currentTime,duration:this.duration})}})}return originalPlay.call(this)};
     // The real recap player uses Web Audio, not a media element. Observe its
     // actual start/stop clock without replacing playback or changing UI state.
     const nativeStart=AudioBufferSourceNode.prototype.start,nativeStop=AudioBufferSourceNode.prototype.stop;
     const audioStarts=new WeakMap();
     const finish=node=>{const s=audioStarts.get(node);if(!s)return;audioStarts.delete(node);window.__filmAudioPlaying=false;void window.filmMediaEvent({event:'ended',at:performance.timeOrigin+performance.now(),currentTime:Math.min(s.duration,s.offset+node.context.currentTime-s.started),duration:s.duration});};
     AudioBufferSourceNode.prototype.start=function(...args){const result=nativeStart.apply(this,args);if(this.buffer?.duration>1){audioStarts.set(this,{duration:this.buffer.duration,started:this.context.currentTime,offset:args[1]??0});window.__filmAudioPlaying=true;void window.filmMediaEvent({event:'playing',at:performance.timeOrigin+performance.now(),currentTime:args[1]??0,duration:this.buffer.duration});this.addEventListener('ended',()=>finish(this),{once:true});}return result;};
     AudioBufferSourceNode.prototype.stop=function(...args){finish(this);return nativeStop.apply(this,args);};
    },{now:FILM_NOW,seedNextSteps:scene.seedNextSteps?{...api.handle('GET','/api/work-os/me/activity-intervals/film-recap/next-steps'),states:{},failures:{},error:null}:null});
    await context.exposeBinding('filmMediaEvent',(_source,event)=>{
     if(!recordingStart)return;
     if(event.event==='playing'){activeSpeech={at:((event.at-recordingStart)/1000),source:'voices/warm.mp3',duration:0,mediaDuration:event.duration};}
     else if(activeSpeech){activeSpeech.duration=event.currentTime;sceneEvidence.speech.push(activeSpeech);activeSpeech=null;}
    });
    await page.goto('http://127.0.0.1:1455/?preview-connect');
    await page.setContent(`<html><head><style>@font-face{font-family:Inter;src:url('/assets/film-Inter.woff2')}*{box-sizing:border-box}body{margin:0;background:#e9eee3;font-family:Inter,sans-serif;color:#182018}iframe{position:absolute;border:1px solid #c5cec1;border-radius:14px;background:#f5f6f1}#mainapp{left:24px;top:24px;width:1392px;height:852px;visibility:${scene.surface==='app'?'visible':'hidden'}}#avatar{left:820px;top:85px;width:540px;height:760px;visibility:${scene.surface==='floating'?'visible':'hidden'};background:transparent;box-shadow:none;border:0}.desktop-note{position:absolute;left:75px;top:135px;font-size:12px;color:#687267;letter-spacing:.13em;text-transform:uppercase}#caption{position:fixed;z-index:100;width:420px;left:34px;bottom:58px;padding:21px 24px;background:#fafaf6f5;border:1px solid #c5cec1;border-radius:13px;pointer-events:none}#caption strong{display:block;font-size:22px;font-weight:600;letter-spacing:-.7px;line-height:1.2}#caption p{font-size:14px;line-height:1.5;color:#52604f;margin:9px 0 0}#brand{position:fixed;left:28px;bottom:9px;font-size:10px;color:#687267;letter-spacing:.08em}#intro{position:fixed;inset:0;background:#18251d;color:#fafaf6;z-index:200;padding:145px 100px;display:flex;align-items:center;gap:80px;transition:opacity .45s}#intro h1{font-size:74px;line-height:1.04;font-weight:550;letter-spacing:-4px;margin:24px 0}#intro p{font-size:22px;color:#c5cec1;max-width:850px;line-height:1.45}#intro small{font-size:14px;letter-spacing:.15em}#intro img{width:200px}#progress{position:absolute;bottom:0;left:0;height:5px;background:#a8f15b;width:${(ottoParts.indexOf(part)+1)/8*100}%}#where{position:fixed;left:28px;top:0;font-size:10px;color:#52604f;z-index:110}</style></head><body><div class="desktop-note">Your work, with a little company.</div><iframe id="mainapp" title="Actual Work OS desktop workspace" src="/?token=demonstration-only&guides=seen"></iframe><iframe id="avatar" title="Actual floating Otto" src="/?window=avatar&token=demonstration-only"></iframe><div id="where">${scene.surface==='floating'?'FLOATING OTTO FIRST':scene.alternate?'IN-APP OTTO · ALTERNATE TAKE':'THEN, INSIDE THE APP'}</div><div id="caption"><strong></strong><p></p></div><div id="brand">ACTUAL DESKTOP APP · DEMONSTRATION DATA · ${String(ottoParts.indexOf(part)+1).padStart(2,'0')} / 08</div><div id="intro"><div><small>${String(ottoParts.indexOf(part)+1).padStart(2,'0')} / 08 · A WORKDAY WITH OTTO</small><h1>${part.title}</h1><p>${part.subtitle}</p></div><img src="/studio-otto.svg"><div id="progress"></div></div></body></html>`);
    await page.addStyleTag({content:'#intro{pointer-events:none}#intro h1,#intro p,#intro img{opacity:0;transform:translateY(18px);transition:opacity .7s,transform .7s}#intro.run h1,#intro.run p,#intro.run img{opacity:1;transform:translateY(0)}#intro p{transition-delay:.12s}'});
    const main=await(await page.locator('#mainapp').elementHandle()).contentFrame();
    const avatar=await(await page.locator('#avatar').elementHandle()).contentFrame();
    await main.locator('.masthead').waitFor({timeout:25000});await main.locator('.boot-overlay').waitFor({state:'detached',timeout:25000});
    await avatar.locator('.avatar-orb,.avatar-panel').first().waitFor({state:'attached',timeout:25000});
    // Clear unrelated arrival flyouts through their real controls before the
    // take; never hide a warning with a filming stylesheet.
    await page.evaluate(()=>{document.querySelector('#mainapp').style.visibility='visible';document.querySelector('#avatar').style.visibility='hidden';});
    for(const dismiss of await main.locator('.notification-dismiss').all())await dismiss.click();
    await page.evaluate(surface=>{document.querySelector('#mainapp').style.visibility=surface==='app'?'visible':'hidden';document.querySelector('#avatar').style.visibility=surface==='floating'?'visible':'hidden';},scene.surface);
    if(scene.surface==='floating'&&await avatar.locator('.avatar-panel').isVisible())await avatar.getByRole('button',{name:'Collapse companion',exact:true}).click();
    if(part.id==='confirm'&&scene.surface==='floating'){
     await avatar.locator('.avatar-bubble-listen').click();
     await avatar.locator('.avatar-bubble-confirm').waitFor({timeout:30000});
     sceneEvidence.preparation='The previous part already played this recap; its actual player was allowed to finish before this confirmation take.';
    }
    if(scene.seedNextSteps&&scene.surface==='floating'){
     await avatar.locator('.avatar-orb').click();await avatar.locator('.chat-next-steps').waitFor();
     await avatar.getByRole('button',{name:'Collapse companion',exact:true}).click();
    }
    let app=scene.surface==='floating'?avatar:main;
    await page.evaluate(()=>{window.filmHandoffs=[];window.filmChannel=new BroadcastChannel('work-os.mascot-preview.v1');window.filmChannel.onmessage=({data})=>{if(['work-os://avatar-open-plan','work-os://avatar-open-eod','work-os://avatar-open-focus'].includes(data.event)){window.filmHandoffs.push(data.event);document.querySelector('#mainapp').style.visibility='visible';document.querySelector('#avatar').style.visibility='hidden';document.querySelector('#where').textContent='MAIN APP · OPENED FROM FLOATING OTTO';}}});
    await page.evaluate(({scene})=>{document.querySelector('#caption strong').textContent=scene.caption;document.querySelector('#caption p').textContent=scene.copy;if(scene.surface==='app'){document.querySelector('#caption').style.bottom='auto';document.querySelector('#caption').style.top='58px';document.querySelector('#caption').style.left='34px';document.querySelector('#intro').style.display='none';}},{scene});
    await main.addStyleTag({content:'*{cursor:none!important} .notice.debug{display:none!important}'});await avatar.addStyleTag({content:'*{cursor:none!important}'});
    await page.addStyleTag({content:'*{cursor:none!important}'});
    // Cosmetic film pointer only. It follows the actual Playwright mouse.
    await page.evaluate(()=>{const pointer=document.createElement('div');pointer.id='film-pointer';pointer.style.cssText='position:fixed;z-index:300;pointer-events:none;width:24px;height:29px;left:700px;top:500px;filter:drop-shadow(0 2px 2px #18201866)';pointer.innerHTML='<svg viewBox="0 0 26 30"><path d="M3 2v23l6-5 5 9 4-2-5-9h9Z" fill="white" stroke="#182018" stroke-width="1.5"/></svg>';document.body.append(pointer)});
    if(!dry){
     const capture=await page.evaluate(()=>({x:Math.round(screenX+(outerWidth-innerWidth)/2),y:Math.round(screenY+outerHeight-innerHeight)}));
     encoder=spawn('ffmpeg',['-y','-v','error','-f','x11grab','-draw_mouse','0','-framerate','60','-video_size','1440x900','-i',`:177.0+${capture.x},${capture.y}`,'-an','-c:v','libx264','-preset','veryfast','-threads','2','-crf','20','-pix_fmt','yuv420p','-g','120','-movflags','+faststart',resolve(dir,scene.surface+'.mp4')],{stdio:['pipe','ignore','inherit']});
     encoderExit=once(encoder,'exit');
     encoder.stdin.on('error',error=>evidence.errors.push(error.message));
     recordingStart=Date.now();await page.waitForTimeout(450);
     assert.equal(encoder.exitCode,null,'Encoder remains running after startup');
    }else recordingStart=Date.now();
    const wait=seconds=>page.waitForTimeout((dry?Math.min(seconds,.3):seconds)*1000);
    if(scene.surface==='floating'){await page.evaluate(()=>{document.querySelector('#film-pointer').style.opacity='0';document.querySelector('#intro').classList.add('run')});await wait(2.8);await page.screenshot({path:resolve(dir,'title.png')});await page.evaluate(()=>{document.querySelector('#intro').style.opacity='0';setTimeout(()=>{document.querySelector('#intro').remove();document.querySelector('#film-pointer').style.opacity='1'},500)});await wait(.6);}
    else await wait(.8);
    const bounds=target=>target.boundingBox();
    const locate=action=>action.selector?app.locator(action.selector).first():app.getByRole(action.role||'button',{name:action.name,exact:action.exact!==false}).first();
    const press=async(target,label)=>{
     await target.waitFor({state:'visible'});await target.scrollIntoViewIfNeeded();const r=await bounds(target);assert(r,'Click target has bounds');
     const x=r.x+r.width/2,y=r.y+r.height/2;
     await page.evaluate(({x,y})=>{const p=document.querySelector('#film-pointer');p.style.transition='left .28s ease,top .28s ease';p.style.left=x+'px';p.style.top=y+'px'},{x,y});
     await wait(.34);await target.click();sceneEvidence.actions.push({type:'click',label,at:(Date.now()-recordingStart)/1000});await wait(.45);
    };
    for(const action of scene.actions){
     if(action.type==='wait'){await wait(action.seconds);continue;}
     if(action.type==='handoff'){await page.waitForFunction(event=>window.filmHandoffs.includes(event),action.event);app=main;sceneEvidence.actions.push({type:'handoff',event:action.event});await wait(.7);continue;}
     if(action.type==='assert'){await app.getByText(action.text,{exact:false}).first().waitFor();sceneEvidence.actions.push({type:'assert',text:action.text});continue;}
     if(action.type==='assertSelector'){await app.locator(action.selector).waitFor();continue;}
     if(action.type==='assertCollapsed'){assert.equal(await avatar.locator('.avatar-panel').isVisible(),false);sceneEvidence.actions.push({type:'collapsed',value:true});continue;}
     if(action.type==='fill'){const target=locate(action);await press(target,action.selector);await target.fill('');await target.pressSequentially(action.value,{delay:dry?1:22});sceneEvidence.actions.push({type:'fill',value:action.value});continue;}
     if(action.type==='closePlan'){const close=app.getByRole('button',{name:'Close',exact:true});if(await close.count())await close.first().click();continue;}
     if(action.type==='speech'){
      await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentWindow.__filmAudioPlaying===true),null,{timeout:10000});
      await wait(dry?1:action.complete?18.3:action.seconds);sceneEvidence.actions.push({type:'speech',complete:!!action.complete});continue;
     }
     if(action.type==='scroll'){
      const target=app.locator(action.selector).first();await target.waitFor();const original=await target.evaluate(e=>e.scrollTop);await target.evaluate((e,to)=>{e.scrollTo({top:to,behavior:'smooth'})},action.to);await wait(1);sceneEvidence.actions.push({type:'scroll',from:original,to:await target.evaluate(e=>e.scrollTop)});continue;
     }
     if(action.type==='olderReview'){
      const card=app.locator('.chat-activity-card').filter({hasText:'Reviewed the employee checklist'});await card.waitFor();await press(card.getByRole('button',{name:'Extra notes'}),'Earlier recap: Extra notes');await wait(1);await press(card.getByRole('button',{name:'Extra notes'}),'Earlier recap: close notes');await press(card.getByRole('button',{name:'Looks right'}),'Earlier recap: Looks right');await card.getByText('Confirmed',{exact:true}).waitFor();continue;
     }
     if(action.type==='suggestions'){
      const root=action.compact?app.locator('.avatar-next-steps'):app.locator('.chat-next-steps');
      await root.waitFor();const first=root.getByRole('button',{name:/Mark done|Mark task done/}).first();await press(first,'Mark done');
      await press(root.getByRole('button',{name:/Edit/}).first(),'Edit new task');const edit=root.locator('input').first();await edit.fill('Publish the recovery checklist');await press(root.getByRole('button',{name:/Save|Add task/}).first(),'Save title / Add task');
      const add=root.getByRole('button',{name:'Add task',exact:true});if(await add.count())await press(add.first(),'Add task');
      await press(root.getByRole('button',{name:'Skip',exact:true}).last(),'Skip remaining suggestion');await wait(1);continue;
     }
     await press(locate(action),action.name||action.selector);
    }
    await wait(scene.hold??3);
    await page.screenshot({path:resolve(dir,scene.surface+'-outcome.png')});writeFileSync(resolve(dir,scene.surface+'.txt'),await app.locator('#root').innerText());
    if(activeSpeech){activeSpeech.duration=Math.min(activeSpeech.mediaDuration,(Date.now()-recordingStart)/1000-activeSpeech.at);sceneEvidence.speech.push(activeSpeech);activeSpeech=null;}
    sceneEvidence.duration=(Date.now()-recordingStart)/1000;sceneEvidence.fixtureSnapshot=api.snapshot();
    if(encoder){if(encoder.exitCode===null)encoder.stdin.write('q');const [code]=await encoderExit;assert.equal(code,0);encoder=null;}
    await context.close();
   }
   writeFileSync(resolve(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({part:part.id,preflight:dry,scenes:evidence.scenes.map(s=>({surface:s.surface,actions:s.actions.length,duration:s.duration})),errors:evidence.errors}));
   assert.equal(evidence.errors.length,0,'No fixture or app errors');assert.equal(evidence.backendCalls.length,0,'No backend contact');
  }catch(error){writeFileSync(resolve(dir,'failure.json'),JSON.stringify({...evidence,error:error.stack},null,2));for(const p of browser.contexts().flatMap(c=>c.pages())){await p.screenshot({path:resolve(dir,'failure.png')}).catch(()=>{});writeFileSync(resolve(dir,'failure.txt'),await p.locator('body').innerText().catch(()=>''));for(const f of p.frames().slice(1)){writeFileSync(resolve(dir,f.url().includes('avatar')?'failure-avatar.txt':'failure-app.txt'),await f.locator('body').innerText().catch(()=>''));}}throw error;}
 }
}finally{if(encoder)encoder.kill('SIGTERM');if(browser)await browser.close();if(xvfb)xvfb.kill('SIGTERM');await new Promise(ok=>server.close(ok));}
