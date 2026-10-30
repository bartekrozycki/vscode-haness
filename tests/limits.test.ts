import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Usage } from '../src/domain/usage';
import { usageLimit } from '../src/domain/session-limits';

test('disabling the optional multiplier ceiling preserves the output-token guard', () => {
  const usage = new Usage();
  usage.add({type:'assistant.usage',data:{cost:6,outputTokens:20}});
  usage.add({type:'assistant.usage',data:{cost:6,outputTokens:20}});
  assert.equal(usageLimit(usage,{timeoutSeconds:900,maxOutputTokens:100,maxPremiumRequests:null}),undefined);
  assert.equal(usageLimit(usage,{timeoutSeconds:900,maxOutputTokens:100}),undefined);
  usage.add({type:'assistant.usage',data:{cost:6,outputTokens:70}});
  assert.match(usageLimit(usage,{timeoutSeconds:900,maxOutputTokens:100,maxPremiumRequests:null})!,/110 \/ 100/);
});
