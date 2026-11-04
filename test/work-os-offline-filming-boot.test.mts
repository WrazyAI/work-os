import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('offline DEV boot permits the unforced day state for interactive filming',()=>{
 const source=readFileSync('desktop/work-os-companion/src/App.tsx','utf8');
 const allowed=source.match(/const allowedDayStates = \[([^\]]+)\]/)?.[1]??'';
 assert.match(allowed,/"real"/,'DEV fixture must permit local clock mutations instead of re-forcing clocked_in after every click');
});
