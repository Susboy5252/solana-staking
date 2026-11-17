// Regenerates the typed program client from the Anchor IDL.
// Run `anchor idl build -o target/idl/staking.json -- --lib` (in ../staking) first.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';

const idlPath = fileURLToPath(new URL('../../staking/target/idl/staking.json', import.meta.url));
const appDir = fileURLToPath(new URL('..', import.meta.url));

const codama = createFromRoot(rootNodeFromAnchor(JSON.parse(readFileSync(idlPath, 'utf8'))));
await codama.accept(
  renderVisitor(appDir, {
    generatedFolder: 'src/generated',
    kitImportStrategy: 'rootOnly',
    syncPackageJson: false,
  }),
);
console.log('Generated client in src/generated');
