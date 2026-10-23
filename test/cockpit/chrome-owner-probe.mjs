/** A stand-in test file for test/cockpit/stable.test.js: it opens Chrome through one launcher, reports ready, and idles [C7]. */
import { writeFileSync } from 'node:fs';
import { findChromeExecutable, launchChromeProcess, startChrome as openChrome } from '../chrome-fixture.js';
import { chromeExecutable, openSnapshotChrome } from './fixture.js';

const profile = process.env.PROBE_PROFILE;
if (process.env.PROBE_LAUNCHER === 'startChrome') await openChrome({ profileDirectory: profile });
else if (process.env.PROBE_LAUNCHER === 'launchChromeProcess') {
  launchChromeProcess({ executable: findChromeExecutable(), args: ['--headless=new', '--no-first-run',
    '--use-mock-keychain', '--password-store=basic', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'] });
} else await openSnapshotChrome(chromeExecutable(), 'about:blank', profile);
writeFileSync(process.env.PROBE_READY, String(process.pid));
setInterval(() => {}, 1000);
