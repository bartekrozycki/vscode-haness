import type { ProjectGateway } from '../ports';
import type { StudioStore } from '../../contracts/studio';
export interface TaskSuggestion {id:string;title:string;requirements:string;estimate?:number;}
export class TaskSuggestions {
 private readonly drafts=new Map<string,{source:string;suggestions:TaskSuggestion[]}>();
 constructor(private readonly projects:ProjectGateway,private readonly store:StudioStore,private readonly publish:(root:string,message:Record<string,unknown>)=>void){}
 propose(root:string,source:string,input:unknown){
  if(!Array.isArray(input)||!input.length||input.length>20)throw new Error('Supply 1–20 draft tasks.');
  const previous=this.drafts.get(root);
  const suggestions=input.map(value=>{
   if(!value||typeof value.title!=='string'||!value.title.trim()||typeof value.requirements!=='string'||!value.requirements.trim())throw new Error('Each draft needs a title and requirements/acceptance criteria.');
   if(value.title.length>300||value.requirements.length>20000)throw new Error('Draft content is too long.');
   if(value.estimate!==undefined&&![1,2,3,5,8,13,21,34,55].includes(value.estimate))throw new Error('Use a Fibonacci estimate or leave it unknown.');
   const existing=previous?.suggestions.find(p=>p.title===value.title&&p.requirements===value.requirements);
   return {id:existing?.id||`SUG-${globalThis.crypto.randomUUID()}`,title:value.title.trim(),requirements:value.requirements.trim(),estimate:value.estimate};
  });
  const result={source:source.slice(0,200),suggestions};this.drafts.set(root,result);this.publish(root,{type:'taskSuggestions',...result});return {suggestions:result.suggestions,source:result.source,notice:'Drafts only. The user can edit/select them in the workbench; acceptance creates unapproved tasks and never starts an agent.'};
 }
 current(root:string){return this.drafts.get(root);}
 async create(root:string,input:unknown){
  const client=this.projects.open(root);if(!await client.initialized())throw new Error('Initialize the project harness explicitly before creating tasks.');
  if(!Array.isArray(input)||!input.length||input.length>20)throw new Error('Select 1–20 tasks.');
  const acceptedFrom=this.drafts.get(root);
  const drafts=acceptedFrom?.suggestions||[];
  const selected=input.map(value=>{const draft=drafts.find(d=>d.id===value.id);if(!draft)throw new Error('Refresh the suggested drafts before accepting them.');if(typeof value.title!=='string'||!value.title.trim()||typeof value.requirements!=='string'||!value.requirements.trim())throw new Error('Each selected draft needs a title and requirements.');return {...draft,title:value.title.trim().slice(0,300),requirements:value.requirements.slice(0,20000)};});
  const created=await this.store.mutate(root,async()=>{
   const state=await client.snapshot();const receipts=new Map<string,string>();
   for(const task of state.tasks){const doc=await client.invoke<{body:string}>({operation:'read',id:task.id});for(const draft of selected)if(doc.body.includes(`Launchpad suggestion: ${draft.id}`))receipts.set(draft.id,task.id);}
   const result=[];
   for(const draft of selected){let id=receipts.get(draft.id);if(!id){const task=await client.invoke<{id:string}>({operation:'create',title:draft.title,requirements:`${draft.requirements}\n\nLaunchpad suggestion: ${draft.id}\nSuggestion source: ${acceptedFrom?.source || 'Unknown'}`,estimate:draft.estimate??'',actor:'user'});id=task.id;receipts.set(draft.id,id);}result.push({suggestion:draft.id,id,approved:false});}return result;
  });
  const latest=this.drafts.get(root);
  const remaining=(latest?.suggestions || []).filter(d=>!selected.some(s=>s.id===d.id));
  const result={source:latest?.source || acceptedFrom?.source || 'Unknown',suggestions:remaining};
  this.drafts.set(root,result);this.publish(root,{type:'taskSuggestions',...result});return created;
 }
}
