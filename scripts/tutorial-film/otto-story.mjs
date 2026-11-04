const click=(name,extra={})=>({type:'click',name,...extra});
const fill=(selector,value)=>({type:'fill',selector,value});
const see=text=>({type:'assert',text});
const openApp={type:'click',selector:'.conversation-launcher'};
const focus=[openApp,click('Focus',{role:'tab'})];
const ask=value=>[{type:'click',selector:'.avatar-orb'},fill('textarea[aria-label="Share an update or instruct the assistant"]',value),click('Send update')];
const appAsk=value=>[openApp,fill('textarea[aria-label="Share an update or add a task"]',value),click('Review update type')];
export const ottoParts=[
 {id:'workday',title:'Ask about your workday',subtitle:'A useful answer starts with your own work.',phase:'workday',scenes:[
  {surface:'floating',caption:'Ask about the day you are having.',copy:'Your focus, recorded updates and task context shape the answer.',actions:[...ask('Summarize my workday so far.'),see('Your focus is to review recovery states')],hold:5},
  {surface:'app',caption:'The same conversation, inside the app.',copy:'Open Otto in your workspace. A question does not change your work.',actions:[...appAsk('Summarize my workday so far.'),see('Your focus is to review recovery states')],hold:5},
 ]},
 {id:'unfinished',title:'Find what is still unfinished',subtitle:'Ask. Inspect the work. Choose your next move.',phase:'workday',scenes:[
  {surface:'floating',caption:'Ask for the unfinished work.',copy:'Otto can show a real task list, not just describe one.',actions:[...ask('What tasks have I yet to complete?'),see('Pending tasks'),click('Pending tasks: hide task list'),click('Pending tasks: show task list')],hold:4},
  {surface:'app',caption:'Review the same work in-app.',copy:'The pending-task tool is available here too. Looking does not mark anything done.',actions:[...appAsk('What tasks have I yet to complete?'),see('Pending tasks'),click('Pending tasks: hide task list'),click('Pending tasks: show task list')],hold:4},
 ]},
 {id:'agenda',title:'Start with a clear plan',subtitle:'Otto prompts. You decide what the day should contain.',phase:'agenda',scenes:[
  {surface:'floating',caption:'A timely nudge, with a direct route.',copy:'Set today’s goal opens the real planning workflow in the main app.',actions:[{type:'wait',seconds:2},click("Set today's goal"),{type:'handoff',event:'work-os://avatar-open-plan'},fill('.planning-session textarea','Review recovery states and publish the employee checklist.'),click('Build my plan'),see('Confirm my day'),click('Confirm my day'),see('OK')],hold:2},
  {surface:'app',alternate:true,caption:'Start the plan directly in-app.',copy:'Open the same planning session, review the draft, then confirm it yourself.',actions:[{type:'closePlan'},...focus,fill('#daily-focus-input','Review recovery states and publish the employee checklist.'),click('Apply goal'),click('Build my plan'),see('Confirm my day'),click('Confirm my day')],hold:2},
 ]},
 {id:'listen',title:'Listen to your recap',subtitle:'Hear the observed context without opening the panel.',phase:'recap',scenes:[
  {surface:'floating',caption:'Listen while Otto stays compact.',copy:'The spoken words and the highlighted recap match. The chat panel stays closed.',actions:[{type:'click',selector:'.avatar-bubble-listen'},{type:'speech',complete:true}],hold:1},
  {surface:'app',caption:'Prefer to listen inside the app?',copy:'Open Focus and play the same recap. Stop it whenever you need to.',actions:[...focus,click('Listen to',{exact:false}),{type:'speech',seconds:5},click('Stop reading',{exact:false})],hold:1},
 ]},
 {id:'confirm',title:'Confirm without opening chat',subtitle:'One small decision, right where the recap arrives.',phase:'recap',scenes:[
  {surface:'floating',caption:'Confirm the recap in place.',copy:'Confirm records your review. It does not approve a task change.',actions:[{type:'click',selector:'.avatar-bubble-confirm'},see('Next steps'),{type:'assertCollapsed'}],hold:4},
  {surface:'app',alternate:true,caption:'Or review it in the app.',copy:'Read the source notes, then confirm the interval yourself.',actions:[...focus,click('Extra notes'),see('publication check'),click('Extra notes'),click('Looks right'),see('Confirmed')],hold:4},
 ]},
 {id:'next-steps',title:'Decide what comes next',subtitle:'Suggestions are proposals. Your choices make the changes.',phase:'next-steps',scenes:[
  {surface:'floating',seedNextSteps:true,caption:'Make the decisions in the bubble.',copy:'Accept one change, edit new work, and skip what you do not need.',actions:[see('Next steps'),{type:'suggestions',compact:true},{type:'assertCollapsed'}],hold:3},
  {surface:'app',alternate:true,seedNextSteps:true,caption:'The same decisions are available in-app.',copy:'Each suggestion has its own accept, edit and skip controls.',actions:[openApp,{type:'suggestions',compact:false}],hold:3},
 ]},
 {id:'history',title:'Catch an earlier recap',subtitle:'Missed a prompt? The record is still there to review.',phase:'history',scenes:[
  {surface:'floating',caption:'Earlier recaps live in floating Tasks.',copy:'Scroll through Recent activity and review an older Not reviewed interval.',actions:[{type:'click',selector:'.avatar-orb'},click('Tasks',{role:'tab',exact:false}),{type:'scroll',selector:'.avatar-chat',to:600},{type:'olderReview'},click('View in app'),{type:'handoff',event:'work-os://avatar-open-focus'}],hold:2},
  {surface:'app',alternate:true,caption:'In-app, look under Focus.',copy:'The same Recent activity stream sits below your daily goal.',actions:[...focus,{type:'scroll',selector:'.goal-composer-panel',to:500},{type:'olderReview'}],hold:4},
 ]},
 {id:'eod',title:'Close the day with your EOD',subtitle:'From the reminder to the report you actually submit.',phase:'eod',scenes:[
  {surface:'floating',caption:'Follow the EOD reminder.',copy:'Open EOD review takes you to the main app—not a submission from the orb.',actions:[{type:'wait',seconds:2},click('Open EOD review'),{type:'handoff',event:'work-os://avatar-open-eod'},see('Submit EOD'),click('Submit EOD'),{type:'assertSelector',selector:'.eod-submitted'}],hold:4},
  {surface:'app',alternate:true,caption:'Open the report directly in-app.',copy:'Review it, submit deliberately, and keep the recorded status distinct from manager approval.',actions:[click('EOD Review'),see('Submit EOD'),click('Submit EOD'),{type:'assertSelector',selector:'.eod-submitted'},click('All EODs')],hold:4},
 ]},
];
export function validateOttoTake(take) {
 if(take.preflight)throw Error('Cannot publish a preflight');
 if(take.parts?.length!==8)throw Error('The film needs all eight parts');
 if(take.backendCalls?.length||take.errors?.length)throw Error('Unsafe or failed capture');
 for(const part of take.parts){
  if(part.scenes?.length!==2||part.scenes[0].surface!=='floating'||part.scenes[1].surface!=='app')throw Error('Missing paired surface: '+part.id);
  if(!part.scenes.every(s=>s.actions.some(a=>a.type==='click')))throw Error('Missing real click: '+part.id);
 }
 const voice=take.parts.find(p=>p.id==='listen');
 if(!voice.scenes.every(s=>s.speech?.some(a=>a.duration>1)))throw Error('Missing audible paired recap speech');
}
