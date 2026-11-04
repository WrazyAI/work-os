#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {validateOttoTake,ottoParts} from './otto-story.mjs';
import {speechLines} from './otto-fixtures.mjs';

export function buildOttoTimeline(parts) {
 for(const part of parts)if(part.preflight)throw Error('Cannot finish a preflight');
 validateOttoTake({preflight:false,parts,backendCalls:parts.flatMap(p=>p.backendCalls??[]),errors:parts.flatMap(p=>p.errors??[])});
 assert.deepEqual(parts.map(p=>p.id),ottoParts.map(p=>p.id),'Every part appears once, in the approved order');
 const result={duration:0,chapters:[],segments:[],speech:[]};
 for(const part of parts){
  result.chapters.push({title:part.title,start:result.duration});
  for(const scene of part.scenes){
   assert.ok(Number.isFinite(scene.videoDuration)&&scene.videoDuration>0,'Measured scene duration');
   result.segments.push({...scene,id:part.id,start:result.duration});
   for(const voice of scene.speech??[]){
    assert.ok(voice.at>=0&&voice.duration>0&&voice.at+voice.duration<=scene.videoDuration+.35,'Speech stays inside its scene');
    result.speech.push({...voice,at:result.duration+voice.at,duration:Math.min(voice.duration,scene.videoDuration-voice.at)});
   }
   result.duration+=scene.videoDuration;
  }
 }
 return result;
}
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,r_frame_rate,width,height','-of','json',file],{encoding:'utf8'}));
const stamp=seconds=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`};
function main(){
 const root=resolve(process.env.FILM_OUT||'/tmp/work-os-render/otto'),out=resolve(root,'finished');mkdirSync(out,{recursive:true});
 const parts=ottoParts.map(p=>{const e=JSON.parse(readFileSync(resolve(root,'capture',p.id,'evidence.json'),'utf8'));for(const s of e.scenes){s.file=resolve(root,'capture',p.id,s.surface+'.mp4');const data=probe(s.file),video=data.streams.find(v=>v.codec_type==='video');assert.equal(video.r_frame_rate,'60/1');assert.equal(video.width,1440);assert.equal(video.height,900);s.videoDuration=Number(data.format.duration);}return e});
 assert.equal(new Set(parts.map(p=>p.buildFingerprint)).size,1,'All takes use one source build');
 const timeline=buildOttoTimeline(parts);
 writeFileSync(resolve(out,'timeline.json'),JSON.stringify(timeline,null,2));
 writeFileSync(resolve(out,'concat.txt'),timeline.segments.map(s=>`file '${s.file.replaceAll("'","'\\''")}'`).join('\n'));
 execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',resolve(out,'concat.txt'),'-c','copy',resolve(out,'silent.mp4')],{stdio:'inherit'});
 execFileSync(process.env.FILM_PYTHON||'python3',[fileURLToPath(new URL('./compose-desktop-music.py',import.meta.url)),resolve(out,'music.wav'),String(timeline.duration)],{stdio:'inherit'});
 const voiceFile=resolve(process.env.FILM_APP||'/tmp/work-os-render/otto/app','voices/warm.mp3');
 const inputs=['-i',resolve(out,'silent.mp4'),'-i',resolve(out,'music.wav')];
 for(const _voice of timeline.speech)inputs.push('-i',voiceFile);
 const ducks=timeline.speech.map(v=>`between(t,${v.at.toFixed(3)},${(v.at+v.duration).toFixed(3)})`).join('+')||'0';
 const filters=[`[1:a]loudnorm=I=-22:TP=-3:LRA=7,volume='if(gt(${ducks},0),0.18,1)':eval=frame[music]`];
 timeline.speech.forEach((v,i)=>filters.push(`[${i+2}:a]atrim=duration=${v.duration.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-2:LRA=7,adelay=${Math.round(v.at*1000)}:all=1[voice${i}]`));
 filters.push(`[music]${timeline.speech.map((_v,i)=>`[voice${i}]`).join('')}amix=inputs=${timeline.speech.length+1}:normalize=0:duration=longest,alimiter=limit=0.95[audio]`);
 execFileSync('ffmpeg',['-y','-v','error',...inputs,'-filter_complex',filters.join(';'),'-map','0:v:0','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(timeline.duration),'-movflags','+faststart',resolve(out,'otto-extended.mp4')],{stdio:'inherit'});
 execFileSync('ffmpeg',['-y','-v','error','-ss','1','-i',resolve(out,'otto-extended.mp4'),'-frames:v','1','-q:v','3',resolve(out,'otto-extended.jpg')],{stdio:'inherit'});
 const cues=[];
 const cue=(from,to,text,top)=>{if(to>from+.02)cues.push(`${stamp(from)} --> ${stamp(to)} line:${top?'15%':'75%'} position:3% align:start size:30%\n${text}`);};
 for(const segment of timeline.segments){
  const p=ottoParts.find(p=>p.id===segment.id),scene=p.scenes.find(s=>s.surface===segment.surface),top=segment.surface==='app';
  let from=segment.start+(segment.surface==='floating'?3.4:.8);const end=segment.start+segment.videoDuration;
  for(const voice of segment.speech??[]){
   const at=segment.start+voice.at;
   cue(from,at,scene.caption+'\n'+scene.copy,top);
   const weights=speechLines.map(l=>l.text.split(/\s+/).length),total=weights.reduce((a,b)=>a+b,0);let elapsed=0;
   for(let i=0;i<speechLines.length;i++){
    const next=elapsed+(voice.mediaDuration??17.976)*weights[i]/total;
    cue(at+elapsed,at+Math.min(next,voice.duration),speechLines[i].text,top);
    elapsed=next;if(elapsed>=voice.duration)break;
   }
   from=at+voice.duration;
  }
  cue(from,end,scene.caption+'\n'+scene.copy,top);
 }
 writeFileSync(resolve(out,'otto-extended.vtt'),'WEBVTT\n\n'+cues.join('\n\n')+'\n');
 writeFileSync(resolve(out,'chapters.json'),JSON.stringify({duration:Number(probe(resolve(out,'otto-extended.mp4')).format.duration),chapters:timeline.chapters},null,2));
 console.log(JSON.stringify({out,duration:timeline.duration,chapters:timeline.chapters,speech:timeline.speech.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
