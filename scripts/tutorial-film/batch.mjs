#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
const rig=dirname(fileURLToPath(import.meta.url));
const python=process.env.FILM_PYTHON||'python3';
// Fail before expensive capture if the render worker has not been provisioned.
execFileSync(python,['-c','import numpy'],{stdio:'inherit'});
for(const slug of process.argv.slice(2)){
  console.log(`Capturing ${slug}`);
  execFileSync(process.execPath,[rig+'/shoot.mjs',slug],{stdio:'inherit'});
  const dir=(process.env.FILM_OUT||'/tmp/work-os-render/recuts/output')+'/'+slug;
  const evidence=JSON.parse(readFileSync(dir+'/evidence.json','utf8'));
  execFileSync(python,[rig+'/compose-desktop-music.py',dir+'/music.wav',String(evidence.duration)],{stdio:'inherit'});
  execFileSync('ffmpeg',['-y','-v','error','-i',dir+'/silent.mp4','-i',dir+'/music.wav','-map','0:v','-map','1:a','-c:v','copy','-af','loudnorm=I=-16:TP=-2:LRA=6','-c:a','aac','-b:a','160k','-ar','48000','-shortest','-movflags','+faststart',dir+'/'+slug+'.mp4'],{stdio:'inherit'});
  execFileSync('ffmpeg',['-y','-v','error','-i',dir+'/poster.png','-frames:v','1','-q:v','3',dir+'/'+slug+'.jpg']);
  execFileSync('ffmpeg',['-y','-v','error','-i',dir+'/'+slug+'.mp4','-vf','fps=1/5,scale=640:-1,tile=2x6','-frames:v','1',dir+'/contact.jpg']);
  console.log(`Finished ${slug}: ${evidence.duration.toFixed(2)}s; ${evidence.actions.length} actions.`);
}
