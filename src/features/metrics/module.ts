import type { SdlcModule } from '../../contracts/api';
export const metricsModule:SdlcModule={apiVersion:1,id:'core.metrics',title:'Session metrics',version:'1.1.0',description:'Observed work-item and research usage; unknown billing values stay unknown.',widgets:[{id:'usage',title:'Observed project usage',placement:'workspace',order:-100,provide:({snapshot})=>{
 if(!snapshot)return;const usage=snapshot.projectUsage;
 const sum=(key:string)=>snapshot.metrics.reduce((n,r)=>n+(Number(r[key])||0),0);
 const sessions=usage?.sessions??snapshot.metrics.length;
 return {kind:'metrics',values:[{label:'Sessions',value:sessions,detail:usage?`${usage.active} active; ${usage.demo} synthetic demo runs`:'Work-item ledger only'},
 {label:'Input tokens',value:(usage?.inputTokens??sum('input_tokens')).toLocaleString('en-US')},
 {label:'Output tokens',value:(usage?.outputTokens??sum('output_tokens')).toLocaleString('en-US')},
 {label:'Duration',value:`${((usage?.durationMs??sum('duration_ms'))/60000).toFixed(1)} min`},
 {label:'USD cost',value:usage?.costUsd===undefined?'Unknown':`$${usage.costUsd.toFixed(4)}`,detail:usage?`Reported for ${usage.costKnown}/${sessions} sessions; local observation, not account billing`:'Not reported'},
 {label:'Premium units',value:usage?.premiumRequests===undefined?'Unknown':usage.premiumRequests.toLocaleString('en-US'),detail:usage?`Reported for ${usage.premiumKnown}/${sessions} sessions; not USD`:'Not reported'}]};
}}]};
