import {defineConfig,mergeConfig} from 'vite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import base from './vite.film.config';
const root=fileURLToPath(new URL('.',import.meta.url));
export default mergeConfig(base,defineConfig({
 root,build:{outDir:'dist-otto-film'},
 define:{'import.meta.env.VITE_WORK_OS_API_URL':JSON.stringify('http://127.0.0.1:1455')},
 plugins:[{
  name:'otto-film-native-adapters',enforce:'pre',
  resolveId(source,importer){
   if(source==='@otto-original-vault')return resolve(root,'src/vault.ts');
   if(source==='./vault'&&importer?.includes('/src/'))return resolve(root,'../../scripts/tutorial-film/otto-vault.mjs');
  },
  transform(code,id){
   if(id.endsWith('/src/App.tsx')){
    let count=0;
    const bridged=code.replace(/if \(!isTauri\(\)\) return;(?=\s+let unlisten: \(\(\) => void\) \| undefined;\s+void listen\("work-os:\/\/avatar-open-(?:eod|focus|plan)"\,)/g,()=>{count++;return '/* Native handoff supplied by the isolated filming bridge. */';});
    if(count!==3)throw Error('Expected exactly three native main-window handoff listeners');
    return bridged;
   }
   if(!id.endsWith('/src/tauriEvents.ts'))return;
   const marker='const PREVIEW_EVENTS = new Set([';
   if(!code.includes(marker))throw Error('Native event bridge seam changed; reverify film adapters');
   return code.replace(marker,marker+'"work-os://avatar-open-plan", "work-os://avatar-open-eod", "work-os://avatar-open-focus", "work-os://conversation-changed", "work-os://pending-tools-changed",');
  },
 }],
}));
