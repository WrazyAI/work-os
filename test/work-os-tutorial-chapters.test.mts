import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const url=new URL('../src/modules/work-os/tutorial-chapters.ts',import.meta.url);

test('chapter selection loads metadata once and the latest requested part wins without starting playback',async()=>{
 assert.ok(existsSync(url),'missing explicit chapter-seek controller');
 const {seekTutorialChapter}=await import(url.href);
 let loads=0;
 const media=Object.assign(new EventTarget(),{currentTime:0,duration:240,readyState:0,preload:'none',load(){loads++}});
 seekTutorialChapter(media,30);seekTutorialChapter(media,120);
 assert.equal(loads,1);
 assert.equal(media.currentTime,0);
 media.readyState=1;media.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(media.currentTime,120);
 seekTutorialChapter(media,60);
 assert.equal(media.currentTime,60);
 assert.equal(loads,1);
});

test('invalid chapter times never change the player',async()=>{
 assert.ok(existsSync(url));
 const {seekTutorialChapter}=await import(url.href);
 const media=Object.assign(new EventTarget(),{currentTime:10,duration:240,readyState:1,preload:'none',load(){throw Error('must not load')}});
 for(const time of [-1,NaN,Infinity])assert.equal(seekTutorialChapter(media,time),false);
 assert.equal(media.currentTime,10);
});
