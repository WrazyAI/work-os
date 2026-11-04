/** Isolated film transport. Never imported by shipped application code. */
export const FILM_DATE = '2026-11-04';
export const FILM_NOW = '2026-11-04T20:17:30Z';
export const speechLines = [
 {text:'Software-development review across three repositories.',time:null},
 {text:'Reviewed the cursor-pagination code',time:'7:21 PM'},
 {text:'Read the blocker notes and an admin work-dashboard request',time:'7:23 PM'},
 {text:'Checked the review queue for pending reports',time:'7:38 PM'},
 {text:'Opened the connect-screen implementation notes',time:'7:43 PM'},
];
const copy = value => structuredClone(value);
const baseTasks = [
 {id:'film-recovery',title:'Review desktop recovery states',description:'Verify the retry states and document the results.',completed:false,due_date:FILM_DATE,created_at:'2026-11-04T09:00:00Z',workflow_status:'in_progress',subtasks:[],subtaskProgress:{total:0,completed:0}},
 {id:'film-checklist',title:'Publish the employee checklist',description:'Check installation, sign-in and the first daily plan.',completed:false,due_date:FILM_DATE,created_at:'2026-11-04T09:01:00Z',workflow_status:'pending',subtasks:[],subtaskProgress:{total:0,completed:0}},
 {id:'film-completed',title:'Verify the sign-in handoff',description:'Confirm the connected app opens the employee workspace.',completed:true,due_date:FILM_DATE,created_at:'2026-11-04T09:02:00Z',completed_at:'2026-11-04T10:45:00Z',subtasks:[],subtaskProgress:{total:0,completed:0}},
];
export function filmRecap(id='film-recap') {
 const old=id==='film-earlier';
 return {id,windowStart:old?'2026-11-04T17:17:00Z':'2026-11-04T19:17:00Z',windowEnd:old?'2026-11-04T18:17:00Z':'2026-11-04T20:17:00Z',label:old?'5:17–6:17 PM':'7:17–8:17 PM',promptKind:'hourly_fallback',generationStatus:'ready',reviewStatus:'inferred',revision:1,reviewVersion:0,
 headline:old?'Reviewed the employee checklist':'Reviewed the cursor-pagination work',detail:old?'Read the installation notes and checked the sign-in handoff.':'Software-development review across three repositories.',
 activities:old?['5:25 PM — Reviewed the installation checklist','5:50 PM — Checked the sign-in handoff']:['7:21 PM — Reviewed the cursor-pagination code','7:23 PM — Read the blocker notes and an admin work-dashboard request','7:38 PM — Checked the review queue for pending reports','7:43 PM — Opened the connect-screen implementation notes'],
 workflow:['Review','Verification'],uncertainties:['The checklist still needs a final publication check.'],recordedActivity:[{description:'Pushed the recovery-state review notes',relation:'performed',url:'https://example.test/demo/review'}],employeeFeedback:null,failureReason:null,generatedAt:FILM_NOW,reviewedAt:null,evidenceExpired:false,evidenceCount:0,evidence:[],coverage:{framesRecorded:4,framesAnalyzed:4}};
}
const suggestions = [
 {proposalId:'film-complete',operation:'complete_task',status:'pending',title:'Review desktop recovery states',rationale:'The reviewed recap includes the recovery-state verification notes.',taskId:'film-recovery',editable:false},
 {proposalId:'film-create',operation:'create_task',status:'pending',title:'Write the recovery checklist',rationale:'A short checklist will make the verified recovery steps repeatable.',taskId:null,editable:true},
 {proposalId:'film-subtask',operation:'add_subtask',status:'pending',title:'Check the installer links',rationale:'The employee checklist still needs a final link check.',taskId:'film-checklist',editable:true},
];
export function createOttoFilmApi({phase='workday',seed={}}={}) {
 let tasks=copy(baseTasks),recaps=[filmRecap(),filmRecap('film-earlier')];
 if(phase==='next-steps')recaps[0].reviewStatus='confirmed';
 const proposalStates=Object.fromEntries(suggestions.map(i=>[i.proposalId,'pending']));
 let plan={id:'film-plan',status:'confirmed',shift_date:FILM_DATE,revision:1,freeform_intent:'Review recovery states and publish the employee checklist.',focus_summary:'Review recovery states and publish the employee checklist.',goal_provenance:'employee',items:tasks.filter(t=>!t.completed).map((t,i)=>({id:'film-plan-'+i,task_id:t.id,title_snapshot:t.title,item_kind:'local_task',source:'due_today',disposition:'selected',completion_state:'open',rank:i,blocker:null}))};
 if(phase==='agenda')plan={...plan,status:'draft',freeform_intent:null,focus_summary:null,items:[]};
 let report={id:'film-eod',report_date:FILM_DATE,status:'draft',submitted_at:null,markdown:'# End-of-day report\n\n## Summary\nReviewed recovery states and prepared the employee checklist.\n\n## Completed today\n- Verify the sign-in handoff.\n\n## In progress\n- Publish the employee checklist.\n\n## Next\n- Finish the publication check.\n\n<details>\n<summary>Full record</summary>\n\n## Activity recaps\nReviewed recovery-state notes. Activity context is not proof of task completion.\n\n</details>'};
 const session={id:'film-session',state:phase==='eod'?'eod_due':'active',scheduled_starts_at:FILM_DATE+'T14:00:00Z',scheduled_ends_at:phase==='eod'?FILM_DATE+'T20:25:00Z':FILM_DATE+'T22:00:00Z',clocked_in_at:FILM_DATE+'T14:00:00Z',clocked_out_at:null,paused_seconds:1800,last_substantive_update_at:FILM_DATE+'T19:17:00Z',first_follow_up_at:FILM_DATE+'T15:15:00Z',next_fallback_at:FILM_DATE+'T20:17:00Z'};
 const day=()=>({...copy(seed.day??{}),at:FILM_NOW,shiftDate:FILM_DATE,shift:{startsAt:session.scheduled_starts_at,endsAt:session.scheduled_ends_at,timezone:'UTC',breaks:[]},dayShift:{startsAt:session.scheduled_starts_at,endsAt:session.scheduled_ends_at},session:copy(session),plan:copy(plan),tasks:copy(tasks),taskHistory:copy(tasks),evidence:[],proposals:[],report:phase==='eod'?copy(report):null,niftySync:{fresh:true,syncedAt:FILM_NOW},signals:{employeeUpdates:2,completedTasks:tasks.filter(t=>t.completed).length,openTasks:tasks.filter(t=>!t.completed).length,activityContext:2,outputEvidence:0},prompt:{kind:phase==='agenda'&&!plan?'plan':phase==='eod'&&!report.submitted_at?'eod':['recap','next-steps','history'].includes(phase)?'hourly_fallback':null,nextPromptAt:FILM_DATE+'T15:17:00Z',required:['agenda','recap','next-steps'].includes(phase),reason:'Demonstration workday'},access:{personId:'film-person',displayName:'Alex Morgan',role:'employee',featureFlags:{voice_input:true,work_memory:true,activity_intervals:true},capabilities:{voice_input:true}},attendance:{source:'worktivity',state:'active',status:'working',observedAt:FILM_NOW,clockedInAt:session.clocked_in_at,clockedOutAt:null,stale:false,fallbackAllowed:false}});
 const nextSteps=(intervalId='film-recap')=>{const recap=recaps.find(r=>r.id===intervalId)??recaps[0];return {intervalId:recap.id,label:recap.label,status:'ready',items:suggestions.map(i=>({...i,status:proposalStates[i.proposalId]}))};};
 return {
  snapshot:()=>copy({tasks,recaps,plan,report,proposals:proposalStates}),
  handle(method,rawPath,body={}) {
   const url=new URL(rawPath,'http://film.local'),p=url.pathname;
   if(p==='/api/work-os/session'&&method==='GET')return {organizationId:'film-org',organizationName:'Demonstration workspace',userId:'film-user',personId:'film-person',displayName:'Alex Morgan',email:'alex@example.test',role:'employee',featureFlags:{voice_input:true,work_memory:true},capabilities:{voice_input:true}};
   if(p==='/api/work-os/me/day'&&method==='GET'){
    const d=day();d.prompt.nextPromptAt=FILM_DATE+(phase==='agenda'?'T20:50:00Z':'T20:17:00Z');
    if(phase==='agenda'){d.session.first_follow_up_at=d.prompt.nextPromptAt;d.prompt.kind=plan?.status==='confirmed'?null:'plan';}
    if(url.searchParams.get('date')==='2026-11-03'){d.shiftDate='2026-11-03';d.report={...copy(report),id:'film-yesterday',report_date:'2026-11-03',status:'rejected',submitted_at:'2026-11-03T17:05:00Z',reviewed_at:'2026-11-04T09:00:00Z'};}
    return d;
   }
   if(p==='/api/work-os/me/onboarding'&&method==='GET')return {...copy(seed.onboarding??{}),onboardingRequired:false,employeeComplete:true,status:'complete',profile:{...copy(seed.onboarding?.profile??{}),displayName:'Alex Morgan',email:'alex@example.test',timezone:'UTC'}};
   if(p==='/api/work-os/me/guides')return {autoOpen:false,seen:{today:true,tasks:true,review:true,insights:true,settings:true},seenPages:['today','tasks','review','insights','settings']};
   if(p==='/api/work-os/me/memory'&&method==='GET')return {facts:[],candidates:[],items:[],remembered:[],recent:[]};
   if(p==='/api/work-os/me/proposals'&&method==='GET')return {proposals:[]};
   if(p==='/api/work-os/me/eod/outstanding'&&method==='GET')return {from:'2026-10-22',through:FILM_DATE,count:phase==='eod'?1:0,days:phase==='eod'?[{date:'2026-11-03',status:'changes_requested',reportId:'film-yesterday',observedMinutes:390,completedTasks:2,hasPlan:true}]:[]};
   if(p==='/api/work-os/me/insights'&&method==='GET')return {...copy(seed.insights??{}),freshness:{niftySyncedAt:FILM_NOW,worktivityObservedAt:FILM_NOW,stale:false}};
   if(p==='/api/work-os/attendance/observe'&&method==='POST')return {changed:false,attendance:day().attendance};
   if(p==='/api/work-os/me/prompt-delivery'&&method==='POST')return {delivered:true};
   if(p==='/api/work-os/me/tasks'&&method==='GET') {
    if(url.searchParams.get('view')==='options')return {people:[{id:'film-person',displayName:'Alex Morgan',email:'alex@example.test'}],projects:[]};
    const pending=['open','pending','overdue'].includes(url.searchParams.get('view'));
    const rows=tasks.filter(t=>!pending||!t.completed);return {tasks:copy(rows),nextCursor:null,totalCount:rows.length,counts:{total:tasks.length,open:tasks.filter(t=>!t.completed).length,completed:tasks.filter(t=>t.completed).length,overdue:0}};
   }
   if(p.startsWith('/api/work-os/me/tasks/')&&method==='GET'){const task=tasks.find(t=>t.id===p.split('/').at(-1));if(!task)throw Error('Unknown demo task');return {task:copy(task),subtasks:[],moveTargets:[],completionEvidence:[]};}
   if(p==='/api/work-os/me/interpret'&&method==='POST') {
    const input=String(body.input??'').trim();let reply,operations=[];
    if(/^summarize my workday so far\.?$/i.test(input))reply='Your focus is to review recovery states and publish the employee checklist. You have verified the sign-in handoff and recorded two updates. Recovery review and the employee checklist are still open.';
    else if(/^(what tasks have i yet to complete\??|show my unfinished tasks\.?)$/i.test(input)){reply='You still have two open tasks: Review desktop recovery states, and Publish the employee checklist. Here is your pending work.';operations=[{op:'display_pending_tasks',statement:'Show my unfinished tasks',limit:20}];}
    else if(/^did i submit an eod report yesterday\??$/i.test(input)){reply='Check the report for yesterday in EOD Review to verify its submission status.';operations=[{op:'navigate_to_page',statement:'Open EOD Review',page:'review'}];}
    else throw Error('Unsupported demo question: '+input);
    return {interpretation:{originalInput:input,reply,claims:[],taskMatches:[],operations},model:'demonstration response'};
   }
   if(p==='/api/work-os/me/activity-intervals'&&method==='GET')return {date:FILM_DATE,from:'2026-10-06',through:FILM_DATE,total:recaps.length,nextCursor:null,intervals:copy(recaps)};
   if(p==='/api/work-os/me/activity-intervals/ensure'&&method==='POST')return {status:'ready',interval:copy(recaps[0]),reason:null};
   if(/\/activity-intervals\/[^/]+\/decision$/.test(p)&&method==='POST') {
    const row=recaps.find(r=>r.id===p.split('/').at(-2));if(!row)throw Error('Unknown demo recap');
    row.reviewStatus=body.action==='amend'?'amended':'confirmed';row.employeeFeedback=body.feedback??null;row.reviewVersion++;row.reviewedAt=FILM_NOW;return {interval:copy(row)};
   }
   if(/\/activity-intervals\/[^/]+\/next-steps$/.test(p))return method==='POST'?{dismissed:0}:nextSteps(p.split('/').at(-2));
   if(p.startsWith('/api/work-os/proposals/')) {
    const id=p.split('/').at(-1);if(!(id in proposalStates))throw Error('Unknown demo proposal');
    if(method==='GET')return {proposal:{status:proposalStates[id]}};
    if(method==='PATCH') {
     if(proposalStates[id]!=='pending')return {outcome:proposalStates[id]};
     proposalStates[id]=body.decision==='accept'?'applied':'rejected';
     if(body.decision==='accept'&&id==='film-complete')tasks=tasks.map(t=>t.id==='film-recovery'?{...t,completed:true,completed_at:FILM_NOW}:t);
     if(body.decision==='accept'&&id==='film-create')tasks.push({...copy(baseTasks[1]),id:'film-new-checklist',title:body.edits?.name??suggestions[1].title});
     return {outcome:proposalStates[id]};
    }
   }
   if(p==='/api/work-os/me/plan'&&method==='GET')return {plan:copy(plan)};
   if(p==='/api/work-os/me/plan/interpret'&&method==='POST')return {build_id:'film-plan-build',interpretation:{summary:String(body.input??body.freeform_intent??'Review recovery states and publish the employee checklist.'),confidence:.96,clarifications:[],commitments:tasks.filter(t=>!t.completed).map(t=>({clientId:t.id,linkedTaskId:t.id,title:t.title,objective:t.description,successCriteria:['Review and publish the final result'],estimateMinutes:30,subtasks:[]})),suggestedTaskIds:tasks.filter(t=>!t.completed).map(t=>t.id),focusSummary:'Review recovery states and publish the employee checklist.'}};
   if(p==='/api/work-os/me/plan'&&['POST','PUT','PATCH'].includes(method)){plan={...(plan??{}),...copy(body),id:'film-plan',shift_date:FILM_DATE,status:body.confirm?'confirmed':body.status??'draft',revision:(plan?.revision??0)+1,items:body.items??[]};return {...copy(plan),taskCreation:{tasks:0,subtasks:0,failed:0,reused:2}};}
   if(p==='/api/work-os/me/eod/screenshots'&&method==='GET')return {date:FILM_DATE,processed:0,excludedPolicy:0,excludedSensitive:0,unavailable:0,pending:0,total:0,viewable:[],hours:[]};
   if(p==='/api/work-os/me/eod/screenshots/prepare'&&method==='POST')return {pending:0,analyzed:0,remaining:0};
   if(p==='/api/work-os/reports/eod'&&method==='POST')return {report:copy(report)};
   if(p==='/api/work-os/reports/film-eod/submit'&&method==='PATCH'){report={...report,markdown:body.markdown??report.markdown,status:'pending_review',submitted_at:FILM_NOW};return copy(report);}
   throw Error(`Unfixture endpoint: ${method} ${p}`);
  },
 };
}
