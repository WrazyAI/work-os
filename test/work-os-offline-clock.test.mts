import test from 'node:test';
import assert from 'node:assert/strict';
import {alignOfflineClock} from '../desktop/work-os-companion/src/offlineClock.ts';
import {applyDayScenario,DEFAULT_DEBUG_SCENARIO} from '../desktop/work-os-companion/src/scenarios.ts';

test('offline pause and close update the simulated observation, not only the session',()=>{
 const day=applyDayScenario(null,{...DEFAULT_DEBUG_SCENARIO,enabled:true,dayState:'real'})!;
 const paused=alignOfflineClock({...day,session:{...day.session!,state:'paused'}});
 assert.equal(paused.attendance?.state,'paused');
 const closed=alignOfflineClock({...day,session:{...day.session!,state:'clocked_out',clocked_out_at:'2026-11-04T17:00:00Z'}});
 assert.equal(closed.attendance?.state,'off_shift');
 assert.equal(closed.attendance?.clockedOutAt,'2026-11-04T17:00:00Z');
 assert.equal(day.attendance?.state,'active','does not mutate the original fixture');
});

test('a not-started offline clock has no invented active provider observation',()=>{
 const day=applyDayScenario(null,{...DEFAULT_DEBUG_SCENARIO,enabled:true,dayState:'scheduled'})!;
 const notStarted=alignOfflineClock(day);
 assert.equal(notStarted.attendance?.state,'off_shift');
 assert.equal(notStarted.attendance?.status,'yet_to_start');
 assert.equal(notStarted.attendance?.clockedInAt,null);
});
