import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@github/copilot-sdk';
import { copilotEvent, copilotSdkExecutor } from '../src/integrations/copilot-sdk/executor';

test('Copilot adapter emits neutral public events and keeps SDK multiplier separate from currency',()=>{
  assert.equal(copilotEvent({type:'assistant.reasoning_delta',data:{deltaContent:'PRIVATE_REASONING'}} as SessionEvent,'fallback'),undefined);
  const message=copilotEvent({type:'assistant.message',data:{content:'Public answer',reasoningText:'PRIVATE_REASONING',encryptedContent:'SECRET'}} as unknown as SessionEvent,'fallback');
  assert.equal(message?.type,'message');assert.ok(!JSON.stringify(message).includes('PRIVATE_REASONING'));
  const tool=copilotEvent({type:'tool.execution_complete',data:{toolCallId:'t',success:true,result:{content:[{type:'image',data:'SECRET_IMAGE'},{type:'text',text:'OK'}]}}} as unknown as SessionEvent,'fallback');
  assert.ok(!JSON.stringify(tool).includes('SECRET_IMAGE'));assert.match(JSON.stringify(tool),/OK/);
  const usage=copilotEvent({type:'assistant.usage',data:{cost:6,inputTokens:100,outputTokens:10}} as SessionEvent,'fallback');
  assert.equal(usage?.type,'usage');if(usage?.type==='usage'){assert.equal(usage.premiumRequests,6);assert.equal(usage.costUsd,undefined);}
});

test('SDK runtime receives scoped environment and optional GitHub token without changing default authentication', async () => {
  const { RuntimeConnection } = await import('@github/copilot-sdk');
  const options: import('@github/copilot-sdk').CopilotClientOptions[] = [];
  let token: string | undefined = 'example-token';
  const fake = { start: async () => {}, stop: async () => {}, createSession: async () => ({ sessionId: 's', disconnect: async () => {} }) } as unknown as import('@github/copilot-sdk').CopilotClient;
  const executor = copilotSdkExecutor({ runtimeOptions: async root => ({ env: { PATH: `${root}/bin` }, gitHubToken: token }), clientFactory: value => { options.push(value); return fake; } });
  const request = { root:'/project', options:{}, signal:new AbortController().signal, tools:[], role:'worker', agent:{name:'agent',description:'',prompt:''}, requestPermission:async()=>({kind:'reject'}), askUser:async()=>undefined, emit:()=>{} } as unknown as import('../src/contracts/executor').ExecutorRequest;
  const session = await executor.createSession(request); await session.dispose();
  assert.deepEqual(options[0].env, { PATH:'/project/bin' });
  assert.equal(options[0].gitHubToken, 'example-token');
  assert.equal(options[0].connection, undefined);
  token = undefined;
  const next = await executor.createSession({ ...request, options:{cliPath:'/path/copilot'} }); await next.dispose();
  assert.equal('gitHubToken' in options[1], false);
  assert.deepEqual(options[1].connection, RuntimeConnection.forStdio({path:'/path/copilot'}));
});
