import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dashboardHtml } from './support/dashboard';

// Product text is English; historical upstream sources and multilingual input fixtures
// are preserved separately and are not part of the shipped product language surface.
test('extension-owned product text and templates contain no Polish localization', async () => {
 const files:string[]=['README.md','package.json'];
 async function walk(root:string){for(const item of await readdir(root,{withFileTypes:true})){const file=`${root}/${item.name}`;if(item.isDirectory())await walk(file);else if(/\.(ts|js|mjs|py|md|json)$/.test(file))files.push(file);}}
 for(const root of ['src','resources/project','resources/module','docs','examples/quality/src'])await walk(root);
 for(const file of files)assert.doesNotMatch(await readFile(file,'utf8'),/[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/,file);
 for(const file of files)assert.doesNotMatch(await readFile(file,'utf8'),/\b(?:Podsumowanie|Zadania|Zadanie|Wymagania|Ocena|Modu\u0142y|Gotowe)\b/,file);
 const html=dashboardHtml('self');assert.match(html,/<html lang="en">/);assert.match(html,/>Refresh</);assert.match(html,/>Modules</);
});
