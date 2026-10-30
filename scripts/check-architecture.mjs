import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const rules = JSON.parse(await readFile(new URL('../architecture.rules.json', import.meta.url), 'utf8'));
const root = path.resolve(process.argv[2] || process.cwd(), 'src');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(ts|js)$/.test(entry.name)) files.push(full);
  }
}
await walk(root);
const known = new Set(files), graph = new Map(), errors = [];
const relative = file => path.relative(root, file).split(path.sep).join('/');
const layer = file => relative(file).split('/')[0];
const matches = (value, pattern) => pattern.endsWith('*') ? value.startsWith(pattern.slice(0, -1)) : value === pattern;
for (const file of files) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const refs = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) refs.push(node.moduleSpecifier);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments.length && ts.isStringLiteral(node.arguments[0])) refs.push(node.arguments[0]);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) refs.push(node.argument.literal);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const ownLayer = layer(file), policy = rules.layers[ownLayer], entry = rules.entrypoints[relative(file)];
  if (!policy && !entry) errors.push(`${relative(file)}: source does not belong to a declared layer`);
  const dependencies = [];
  for (const ref of refs) {
    const specifier = ref.text, line = source.getLineAndCharacterOfPosition(ref.getStart()).line + 1;
    const report = message => errors.push(`${relative(file)}:${line}: ${message}`);
    if (!specifier.startsWith('.')) {
      const allowed = [...policy?.external || [], ...rules.fileExternals[relative(file)] || []];
      if (!allowed.some(pattern => matches(specifier, pattern))) report(`${ownLayer} cannot import external package ${specifier}`);
      continue;
    }
    const target = path.resolve(path.dirname(file), specifier);
    const resolved = [target, target + '.ts', target + '.js', target.replace(/\.js$/, '.ts'), path.join(target, 'index.ts'), path.join(target, 'index.js')].find(p => known.has(p));
    if (!resolved) { report(`unresolved source import ${specifier}`); continue; }
    dependencies.push(resolved);
    const targetLayer = layer(resolved);
    if (!(entry || policy?.imports || []).includes(targetLayer)) report(`${ownLayer} cannot import ${targetLayer}: ${relative(resolved)}`);
    if (rules.isolatedModules.includes(ownLayer) && targetLayer === ownLayer && relative(file).split('/')[1] !== relative(resolved).split('/')[1]) report(`module boundary crossed: ${relative(resolved)}`);
  }
  graph.set(file, dependencies);
}
const active = new Set(), complete = new Set();
function cycles(file, chain = []) {
  if (active.has(file)) { errors.push(`Dependency cycle: ${[...chain.slice(chain.indexOf(file)), file].map(relative).join(' -> ')}`); return; }
  if (complete.has(file)) return;
  active.add(file);
  for (const next of graph.get(file) || []) cycles(next, [...chain, file]);
  active.delete(file); complete.add(file);
}
for (const file of files) cycles(file);
if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
else process.stdout.write(`Architecture boundaries OK (${files.length} source files, no cycles).\n`);
