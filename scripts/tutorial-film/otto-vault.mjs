/** Filming-build-only storage adapter: emulate the native shared vault locally. */
export * from '@otto-original-vault';
import {secureState as native} from '@otto-original-vault';
const get=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('otto-film:'+key))??fallback;}catch{return fallback;}};
const put=(key,value)=>localStorage.setItem('otto-film:'+key,JSON.stringify(value));
export const secureState={...native,
 conversation:async scope=>get('chat:'+scope,get('seed-chat',[])),
 saveConversation:async(scope,turns)=>{const all=new Map(get('chat:'+scope,[]).map(t=>[t.id,t]));for(const t of turns)all.set(t.id,t);put('chat:'+scope,[...all.values()]);},
 clearConversation:async scope=>put('chat:'+scope,[]),
 pendingTools:async scope=>get('tools:'+scope,null),
 savePendingTools:async(scope,value)=>put('tools:'+scope,value),
 clearPendingTools:async scope=>put('tools:'+scope,null),
};
