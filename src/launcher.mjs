import process from 'node:process';
import { spawn } from 'node:child_process';
import { applicationEntry, resolveRuntimePaths } from './runtime-paths.mjs';

const COMMANDS = {
  sync: { entry: 'src/index.mjs', args: [] },
  quick: { entry: 'src/index.mjs', args: ['--mode=quick'] },
  full: { entry: 'src/index.mjs', args: ['--mode=full'] },
  publish: { entry: 'src/publish-cli.mjs', args: [] },
  scheduled: { entry: 'src/scheduled.mjs', args: [] },
  'setup-login': { entry: 'src/login-setup.mjs', args: [] },
  doctor: { entry: 'src/doctor.mjs', args: [] }
};

function usage() {
  console.log('Usage: node src/launcher.mjs <quick|full|publish|scheduled|setup-login|doctor> [arguments]');
}

const [command = '', ...forwarded] = process.argv.slice(2);
if (!COMMANDS[command]) {
  usage();
  process.exitCode = command ? 2 : 0;
} else {
  const paths = resolveRuntimePaths();
  const target = COMMANDS[command];
  const child = spawn(process.execPath, [
    applicationEntry(target.entry, paths),
    ...target.args,
    ...forwarded
  ], {
    cwd: paths.appRoot,
    stdio: 'inherit',
    windowsHide: false
  });

  child.once('error', error => {
    console.error(`Could not launch Brightspace Sync: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
