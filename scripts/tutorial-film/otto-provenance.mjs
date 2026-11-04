import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
/** Hash the complete capture build, including style, art and spoken samples. */
export function fingerprintBuild(root) {
 const hash=createHash('sha256');
 const visit=(directory,prefix='')=>{
  for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const relative=prefix+entry.name,path=resolve(directory,entry.name);
   if(entry.isDirectory())visit(path,relative+'/');
   else if(entry.isFile()){const bytes=readFileSync(path);hash.update(relative+'\0'+bytes.length+'\0');hash.update(bytes);}
  }
 };
 visit(resolve(root));return hash.digest('hex');
}
