import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import { chooseCaptionBox, validateTake } from '../scripts/tutorial-film/quality.mjs';

test('caption placement moves away from the demonstrated control', () => {
  const a = chooseCaptionBox([{x:900,y:600,width:500,height:280}]);
  const b = chooseCaptionBox([{x:0,y:0,width:1000,height:500}]);
  assert.notDeepEqual(a,b);
  for (const [box, subject] of [[a,{x:900,y:600,width:500,height:280}],[b,{x:0,y:0,width:1000,height:500}]]) {
    assert.ok(box.x+box.width<=subject.x || box.x>=subject.x+subject.width || box.y+box.height<=subject.y || box.y>=subject.y+subject.height);
  }
});

test('static overviews cannot pass as completed interactive tutorials', () => {
  assert.throws(()=>validateTake({slug:'insights',actions:[],chapters:[],backendCalls:[],errors:[]}),/interaction/);
});

test('Insights requires three demonstrated ranges and a real scroll', () => {
  const take={slug:'insights',actions:[{type:'click',label:'Today'},{type:'click',label:'7d'},{type:'click',label:'30d'}],chapters:[{position:'top-left'},{position:'bottom-right'}],backendCalls:[],errors:[]};
  assert.throws(()=>validateTake(take),/scroll/);
  assert.doesNotThrow(()=>validateTake({...take,actions:[...take.actions,{type:'scroll',distance:700}]}));
});

test('backend contact, errors and unchanging caption placement block publication', () => {
  const take={slug:'settings',actions:[{type:'click'},{type:'click'},{type:'click'}],chapters:[{position:'top-left'},{position:'bottom-right'}],backendCalls:[],errors:[]};
  assert.throws(()=>validateTake({...take,backendCalls:['/api/live']}),/backend/);
  assert.throws(()=>validateTake({...take,errors:['broken']}),/error/);
  assert.throws(()=>validateTake({...take,chapters:[{position:'top-left'}]}),/caption/);
});

test('the production batch carries its composer and supports the provisioned interpreter',()=>{
 assert.ok(existsSync('scripts/tutorial-film/compose-desktop-music.py'),'composer ships with the capture rig');
 assert.match(readFileSync('scripts/tutorial-film/batch.mjs','utf8'),/process\.env\.FILM_PYTHON/);
});

test('a recap take must bring the GitHub evidence into the actual window',()=>{
 const take={slug:'activity-recaps',actions:[{type:'click'},{type:'click'},{type:'click'}],chapters:[{position:'top-left'},{position:'bottom-left'}],backendCalls:[],errors:[]};
 assert.throws(()=>validateTake(take),/evidence.*viewport/);
 assert.doesNotThrow(()=>validateTake({...take,actions:[...take.actions,{type:'viewport',selector:'.chat-activity-github',fullyVisible:true}]}));
});
