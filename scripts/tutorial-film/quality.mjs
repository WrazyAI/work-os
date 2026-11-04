const overlap = (a,b) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));

/** Choose a reading-safe corner, avoiding the current subject and click target. */
export function chooseCaptionBox(subjects, preferred='bottom-right') {
  const boxes=[
    {x:982,y:750,width:430,height:126,position:'bottom-right'},
    {x:28,y:750,width:430,height:126,position:'bottom-left'},
    {x:982,y:28,width:430,height:126,position:'top-right'},
    {x:28,y:28,width:430,height:126,position:'top-left'},
  ];
  return boxes.sort((a,b)=>{
    const score=box=>subjects.reduce((sum,subject)=>sum+overlap(box,subject),0)+(box.position===preferred?0:1);
    return score(a)-score(b);
  })[0];
}

/** This is a minimum technical gate, never a substitute for watching the film. */
export function validateTake(take) {
  if(take.actions.filter(a=>a.type==='click').length<3) throw new Error('Missing substantive interactions');
  if(take.backendCalls.length) throw new Error('Unexpected backend contact');
  if(take.errors.length) throw new Error('Browser errors in take');
  if(new Set(take.chapters.map(c=>c.position)).size<2) throw new Error('Unchanging caption placement');
  if(take.slug==='insights') {
    for(const range of ['Today','7d','30d']) if(!take.actions.some(a=>a.type==='click'&&a.label===range)) throw new Error(`Missing range ${range}`);
    if(!take.actions.some(a=>a.type==='scroll'&&Math.abs(a.distance)>400)) throw new Error('Missing real scroll');
  }
  if(take.slug==='activity-recaps'&&!take.actions.some(a=>a.type==='viewport'&&a.selector==='.chat-activity-github'&&a.fullyVisible)) throw new Error('Recap evidence must be in the viewport');
}
