#!/usr/bin/env node
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chooseCaptionBox,validateTake} from './quality.mjs';
import {stories} from './stories.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/home/dev/agent-os/node_modules/playwright');
const slug=process.argv[2],story=stories[slug];assert(story,`Unknown story ${slug}`);
const dry=process.argv.includes('--preflight'),fps=60;
const out=resolve(process.env.FILM_OUT||'/tmp/work-os-render/recuts/output',slug);mkdirSync(out,{recursive:true});
let server,encoder,browser;
const evidence={slug,sourceCommit:'c9a702f6',source:'Actual current companion · Demonstration data',actions:[],chapters:[],errors:[],backendCalls:[],fps};
try{
 let base=process.env.FILM_BASE;
 if(!base){
  const root=resolve(process.env.FILM_APP||'/tmp/work-os-render/recuts/app');
  server=createServer((req,res)=>{const name=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!name.startsWith(root+'/')&&name!==root){res.writeHead(403).end();return;}try{const file=extname(name)?name:resolve(root,'index.html');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.wasm':'application/wasm','.html':'text/html','.mp3':'audio/mpeg'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404).end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 }
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(30000);
 page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.route('**/*',route=>{
  const url=route.request().url();if(url.includes('/api/')||(!url.startsWith(base)&&/^https?:/.test(url))){evidence.backendCalls.push(url);return route.abort();}return route.continue();
 });
 await page.clock.setFixedTime(new Date('2026-11-04T16:45:00Z'));
 let app=page;
 if(story.floating){
  // Give the capture stage the same secure localhost origin as its real app
  // window (an opaque about:blank parent disables crypto in child frames).
  await page.goto(base+'/?preview-connect',{waitUntil:'domcontentloaded'});
  await page.setContent(`<body style="margin:0;background:#e6ece1"><iframe title="Actual companion window" src="${base+story.url}" style="position:absolute;left:760px;top:70px;width:540px;height:760px;border:1px solid #c5cec1;border-radius:18px;box-shadow:0 20px 80px #18201826;background:transparent"></iframe></body>`);
  app=await (await page.locator('iframe').elementHandle()).contentFrame();
 }else await page.goto(base+story.url,{waitUntil:'domcontentloaded'});
 await app.locator(story.ready||'.masthead').waitFor({timeout:20000});
 await app.locator('.boot-overlay').waitFor({state:'detached'});
 if(!story.preview){await app.getByRole('button',{name:'Expand sidebar',exact:true}).click();}
 const font=readFileSync(new URL('./InterVariable.woff2',import.meta.url)).toString('base64');
 const art=readFileSync(new URL('./studio-otto.svg',import.meta.url),'utf8');
 await page.addStyleTag({content:`
 @font-face{font-family:Film;src:url(data:font/woff2;base64,${font})}*{cursor:none!important}html{scroll-behavior:auto!important}.debug-notice,.notice.debug{display:none!important}
 .film{position:fixed;pointer-events:none;z-index:2147483000;font-family:Film,Inter,sans-serif;color:#182018;box-sizing:border-box}
 #film-caption{width:430px;padding:18px 22px;background:#fafaf6f5;border:1px solid #c5cec1;border-radius:14px;box-shadow:0 8px 28px #18201818;min-height:118px;backdrop-filter:blur(12px)}#film-caption small{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#536052}#film-caption strong{display:block;font-size:22px;line-height:1.2;letter-spacing:-.65px;margin:7px 0}#film-caption p{font-size:15px;line-height:1.4;margin:0;color:#536052}
 #film-intro{inset:0;background:#e6ece1;display:grid;grid-template-columns:1.35fr 1fr;padding:90px;gap:80px;align-items:center;overflow:hidden}#film-intro h1{font-size:82px;font-weight:560;line-height:1.02;letter-spacing:-4.5px;margin:24px 0}#film-intro p{font-size:23px;line-height:1.45;max-width:660px;color:#536052}#film-intro .art{width:270px;justify-self:center}#film-intro small{font-size:14px;letter-spacing:2px;text-transform:uppercase}#film-intro .rule{height:5px;background:#182018;transform-origin:left;margin-top:32px}#film-intro.variant-1{background:#182018;color:#fafaf6;grid-template-columns:1fr 1.4fr}#film-intro.variant-1 p{color:#c5cec1}#film-intro.variant-1 .art{order:-1;width:310px}#film-intro.variant-1 .rule{background:#a8f15b}#film-intro.variant-2{background:#f5f6f1;grid-template-columns:1fr;text-align:center;padding:60px 160px}#film-intro.variant-2 h1{max-width:1050px;margin:10px auto}#film-intro.variant-2 p{margin:0 auto}#film-intro.variant-2 .art{position:absolute;width:130px;right:60px;bottom:45px}#film-intro.variant-2 .rule{width:280px;margin:24px auto}
 #film-cursor{width:26px;height:30px;filter:drop-shadow(0 2px 3px #18201860)}#film-ring{width:46px;height:46px;border:2px solid #4a7d22;border-radius:50%;background:#a8f15b30}#film-brand{left:26px;bottom:12px;font-size:10px;letter-spacing:.3px;color:#687267;background:#fafaf6e8;padding:5px 9px;border-radius:6px}#film-end{left:28px;top:28px;max-width:640px;padding:24px 32px;background:#182018;color:#fafaf6;border-radius:16px}#film-end strong{font-size:30px;font-weight:550;letter-spacing:-1px;display:block}#film-end p{font-size:17px;margin:10px 0 0;color:#c5cec1}
 `});
 await page.evaluate(({art,story})=>{
  const add=(id,html)=>{const e=document.createElement('div');e.id=id;e.className='film';e.innerHTML=html;document.body.append(e);return e;};
  add('film-caption','<small></small><strong></strong><p></p>');
  const intro=add('film-intro',`<div class="words"><small>Work OS / ${story.label}</small><h1>${story.title}</h1><p>${story.promise}</p><div class="rule"></div></div><div class="art">${art}</div>`);intro.classList.add(`variant-${story.variant}`);
  add('film-cursor','<svg viewBox="0 0 26 30"><path d="M3 2v23l6-5 5 9 4-2-5-9h9Z" fill="#fff" stroke="#182018" stroke-width="1.5"/></svg>');add('film-ring','');
  add('film-brand','ACTUAL DESKTOP APP · DEMONSTRATION DATA');
  add('film-end',`<strong>${story.end}</strong><p>${story.next}</p>`);
  window.film={caption(n,title,copy){const e=document.querySelector('#film-caption');e.querySelector('small').textContent=n;e.querySelector('strong').textContent=title;e.querySelector('p').textContent=copy;},frame(s){
   const by=id=>document.getElementById(id);by('film-caption').style.cssText=`left:${s.box.x}px;top:${s.box.y}px;opacity:${s.captionOpacity};transform:translateY(${s.shift}px)`;
   by('film-intro').style.cssText=`opacity:${s.intro};visibility:${s.intro>0?'visible':'hidden'};clip-path:inset(0 ${s.wipe}% 0 0)`;
   by('film-intro').querySelector('.words').style.transform=`translateY(${(1-s.enter)*38}px)`;by('film-intro').querySelector('.words').style.opacity=s.enter;
   by('film-intro').querySelector('.art').style.transform=`translateY(${Math.sin(s.t*2)*7}px) rotate(${Math.sin(s.t)*2}deg)`;by('film-intro').querySelector('.rule').style.transform=`scaleX(${s.enter})`;
   by('film-cursor').style.cssText=`left:${s.pointer.x}px;top:${s.pointer.y}px;opacity:${s.intro>.4?0:1}`;
   by('film-ring').style.cssText=`left:${s.pointer.x-23}px;top:${s.pointer.y-23}px;opacity:${s.ring};transform:scale(${1.4-s.ring})`;
   by('film-end').style.cssText=`opacity:${s.end};transform:translateY(${(1-s.end)*24}px)`;
  }};
 },{art,story});
 let frames=0,pointer={x:1250,y:750},box=chooseCaptionBox([]),intro=1,enter=0,wipe=0,captionOpacity=0,shift=0,end=0,lastClick=-100;
 const ease=p=>1-(1-p)**3,lerp=(a,b,p)=>a+(b-a)*p;
 if(!dry){encoder=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','20','-pix_fmt','yuv420p','-g','120','-movflags','+faststart',out+'/silent.mp4'],{stdio:['pipe','ignore','inherit']});encoder.on('error',e=>evidence.errors.push(e.message));}
 const cdp=await context.newCDPSession(page);
 async function render(seconds,update=()=>{}){
  if(dry)await page.waitForTimeout(Math.min(seconds*1000,300));
  const count=dry?1:Math.round(seconds*fps);
  for(let n=0;n<count;n++){
   const p=count===1?1:n/(count-1);await update(p);const t=frames/fps;
   await page.evaluate(s=>window.film.frame(s),{t,box,pointer,intro,enter,wipe,captionOpacity,shift,end,ring:Math.max(0,1-(t-lastClick)/.5)});
   if(!dry){const image=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:90,fromSurface:true,optimizeForSpeed:true});if(!encoder.stdin.write(Buffer.from(image.data,'base64')))await once(encoder.stdin,'drain');}
   frames+=dry?Math.round(seconds*fps):1;
  }
 }
 const locator=action=>action.selector?app.locator(action.selector).first():app.getByRole(action.role||'button',{name:action.name,exact:action.exact!==false}).first();
 async function scrollTo(target){
  const from=await page.evaluate(()=>scrollY),to=typeof target==='number'?target:await target.evaluate(e=>scrollY+e.getBoundingClientRect().top-210);
  await render(1,p=>page.evaluate(y=>window.scrollTo(0,y),lerp(from,Math.max(0,to),p*p*(3-2*p))));
  const actual=await page.evaluate(()=>scrollY);evidence.actions.push({at:frames/fps,type:'scroll',distance:actual-from});
 }
 await render(1.8,p=>{enter=ease(Math.min(1,p*2));});
 await page.screenshot({path:out+'/poster.png'});
 await render(.75,p=>{wipe=ease(p)*100;intro=1;});intro=0;
 for(let i=0;i<story.scenes.length;i++){
  const scene=story.scenes[i];
  await render(.22,p=>{captionOpacity=1-p;shift=-8*p;});
  if(scene.scroll!==undefined)await scrollTo(typeof scene.scroll==='string'?page.locator(scene.scroll).first():scene.scroll);
  if(scene.scrollWithin){const el=app.locator(scene.scrollWithin.selector);const from=await el.evaluate(e=>e.scrollTop),to=await el.evaluate((e,to)=>to==='bottom'?e.scrollHeight-e.clientHeight:to,scene.scrollWithin.to);await render(1.2,p=>el.evaluate((e,y)=>{e.scrollTop=y;},lerp(from,to,p*p*(3-2*p))));evidence.actions.push({type:'scroll',distance:to-from,at:frames/fps});}
  const subjects=[];if(scene.subject){const s=await app.locator(scene.subject).first().boundingBox();assert(s,`Missing subject ${scene.subject}`);subjects.push(s);}if(story.floating)subjects.push({x:760,y:70,width:540,height:760});
  box=chooseCaptionBox(subjects,scene.position||(['bottom-right','top-left','bottom-left','top-right'][i%4]));
  await page.evaluate(a=>window.film.caption(...a),[`${i+1} / ${story.scenes.length}`,scene.title,scene.copy]);
  evidence.chapters.push({at:frames/fps,title:scene.title,copy:scene.copy,position:box.position,box});
  await render(.35,p=>{captionOpacity=ease(p);shift=10*(1-ease(p));});
  for(const action of scene.actions||[]){
   if(action.type==='assertViewport'){
    const rect=await app.locator(action.selector).boundingBox();assert(rect,`Missing visible subject ${action.selector}`);
    const bounds=story.floating?{x:760,y:70,width:540,height:690}:{x:0,y:0,width:1440,height:900};
    assert(rect.x>=bounds.x&&rect.y>=bounds.y&&rect.x+rect.width<=bounds.x+bounds.width&&rect.y+rect.height<=bounds.y+bounds.height,`${action.selector} is fully inside the reading window`);
    evidence.actions.push({at:frames/fps,type:'viewport',selector:action.selector,fullyVisible:true,rect});continue;
   }
   if(action.type==='assertSelector'){await app.locator(action.selector).waitFor();continue;}
   if(action.type==='assert'){await app.locator('#root').getByText(action.text,{exact:false}).first().waitFor();continue;}
   if(action.type==='key'){await page.keyboard.press(action.key);evidence.actions.push({type:'key',key:action.key,at:frames/fps});await render(.5);continue;}
   const target=locator(action);await target.waitFor({state:'visible'});
   if(story.floating)await target.scrollIntoViewIfNeeded();
   let rect=await target.boundingBox();assert(rect,'Action has bounds');
   if(rect.y<20||rect.y+rect.height>870){await scrollTo(target);rect=await target.boundingBox();}
   const safe=chooseCaptionBox([rect],box.position);if(safe.position!==box.position){box=safe;evidence.chapters.push({at:frames/fps,title:scene.title,copy:scene.copy,position:box.position,box});}
   const from={...pointer},to={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
   await render(.65,p=>{pointer={x:lerp(from.x,to.x,ease(p)),y:lerp(from.y,to.y,ease(p))};});
   const label=action.name||await target.textContent();await target.click();lastClick=frames/fps;
   evidence.actions.push({at:frames/fps,type:'click',label});await render(.45);
   if(action.type==='fill'){
    await target.fill('');for(const char of action.value){await target.pressSequentially(char);await render(.045);}
    evidence.actions.push({type:'fill',at:frames/fps,value:action.value});
   }
   await render(action.hold??.6);
  }
  await render(scene.hold??3.1);
  await page.screenshot({path:out+`/scene-${i+1}.png`});
  writeFileSync(out+`/scene-${i+1}.txt`,await app.locator('#root').innerText());
 }
 await render(.4,p=>{captionOpacity=1-p;end=ease(p);});await render(2.5);
 validateTake(evidence);evidence.frames=frames;evidence.duration=frames/fps;evidence.preflight=dry;
 if(encoder){encoder.stdin.end();const [code]=await once(encoder,'exit');assert.equal(code,0,'Encoder succeeds');encoder=null;}
 const stamp=t=>{const ms=Math.round(t*1000);return `00:${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
 writeFileSync(out+'/'+slug+'.vtt','WEBVTT\n\n'+evidence.chapters.map((c,i)=>`${stamp(c.at)} --> ${stamp(evidence.chapters[i+1]?.at??evidence.duration)} line:${c.position.startsWith('top')?'15%':'75%'} position:${c.position.endsWith('left')?'3%':'67%'} align:start size:30%\n${c.title}\n${c.copy}`).join('\n\n')+'\n');
 writeFileSync(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({slug,dry,duration:evidence.duration,actions:evidence.actions.length,out}));
}finally{if(encoder)encoder.kill('SIGTERM');if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
