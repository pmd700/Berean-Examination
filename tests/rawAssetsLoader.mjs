import { readFile } from 'node:fs/promises';
export async function load(url, context, nextLoad) {
  const file = new URL(url);
  if (file.protocol === 'file:' && file.searchParams.has('raw')) {
    file.search = '';
    return { format: 'module', source: `export default ${JSON.stringify(await readFile(file, 'utf8'))};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
