import type {DayData} from './types';

/** Scenario-only: align the simulated observation with a simulated local click.
 * Never used for a live provider action or as a substitute for readback. */
export function alignOfflineClock(day:DayData):DayData {
  const session=day.session;
  const closed=session?.state==='clocked_out',paused=session?.state==='paused';
  return {...day,attendance:{
    source:'worktivity',state:closed||!session?'off_shift':paused?'paused':'active',
    status:!session?'yet_to_start':closed?'clock_out':paused?'break':'working',observedAt:new Date().toISOString(),
    clockedInAt:session?.clocked_in_at??null,clockedOutAt:session?.clocked_out_at??null,
    stale:false,fallbackAllowed:false,message:'Offline demonstration observation — no provider was contacted.',
  }};
}
