import process from 'node:process';
import { getDesktopStatus } from './desktop-backend.mjs';

const [command = '', ...options] = process.argv.slice(2);

if (command !== 'status' || !options.includes('--json')) {
  console.error('Usage: node src/desktop-backend-cli.mjs status --json');
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await getDesktopStatus()));
  } catch (error) {
    console.error(`Could not read Brightspace Sync status: ${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}
