import type { Snapshot } from '../../contracts/model';
import type { LiveSession } from '../../contracts/live';
import type { StudioRecord } from '../../contracts/studio';
export interface ProjectUsage {
 sessions:number; active:number; inputTokens:number; outputTokens:number; durationMs:number;
 costUsd?:number; costKnown:number; premiumRequests?:number; premiumKnown:number; demo:number;
}
const known=(value:unknown)=>value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):undefined;
const elapsed=(start:string,end:string|number)=>{const a=Date.parse(start),b=typeof end==='number'?end:Date.parse(end);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,b-a):0;};
/** Deduplicate authoritative run attempts, durable receipts and provisional live usage. */
export function projectUsage(snapshot:Snapshot,records:StudioRecord[],live:LiveSession[],now=Date.now()):ProjectUsage {
 const runs=new Map<string,{input?:number;output?:number;duration?:number;cost?:number;premium?:number;active:boolean;demo:boolean}>();
 for(const run of snapshot.runs)runs.set(run.id,{active:false,demo:run.outcome==='demo',duration:run.finished?elapsed(run.started,run.finished):0});
 for(const session of live){const terminal=session.finished||(['interrupted','failed','cancelled','completed','limit'].includes(session.status)?session.updated:now);runs.set(session.run,{input:session.inputTokens,output:session.outputTokens,duration:elapsed(session.started,terminal),cost:session.costUsd,premium:session.premiumRequests,active:!session.finished&&!['interrupted','failed','cancelled','completed','limit'].includes(session.status),demo:session.status==='demo'});}
 const row=(id:string,r:Record<string,unknown>,demo=false)=>{const previous=runs.get(id);runs.set(id,{input:known(r.input_tokens)??previous?.input,output:known(r.output_tokens)??previous?.output,duration:known(r.duration_ms)??previous?.duration,cost:known(r.cost_usd)??previous?.cost,premium:known(r.premium_requests)??previous?.premium,active:false,demo});};
 for(const record of records)if(record.data.run&&record.data.usage)row(String(record.data.run),record.data.usage as Record<string,unknown>);
 snapshot.metrics.forEach((metric,index)=>row(metric.run||`legacy-${index}`,metric,snapshot.runs.some(r=>r.id===metric.run&&r.outcome==='demo')));
 const values=[...runs.values()], costs=values.filter(r=>r.cost!==undefined),premiums=values.filter(r=>r.premium!==undefined);
 return {sessions:values.length,active:values.filter(r=>r.active).length,inputTokens:values.reduce((n,r)=>n+(r.input||0),0),outputTokens:values.reduce((n,r)=>n+(r.output||0),0),durationMs:values.reduce((n,r)=>n+(r.duration||0),0),costUsd:costs.length?costs.reduce((n,r)=>n+r.cost!,0):undefined,costKnown:costs.length,premiumRequests:premiums.length?premiums.reduce((n,r)=>n+r.premium!,0):undefined,premiumKnown:premiums.length,demo:values.filter(r=>r.demo).length};
}
