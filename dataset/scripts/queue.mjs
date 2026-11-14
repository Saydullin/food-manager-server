// URL queue for recipe pages.
//   node dataset/scripts/queue.mjs add <url> [url...]              add pending URLs (unknown ones only)
//   node dataset/scripts/queue.mjs add --file <path>               one URL per line
//   node dataset/scripts/queue.mjs skip <url> <reason...>          give up on a URL (not a dish, duplicate, junk...)
//   node dataset/scripts/queue.mjs block-host <host> <reason...>   skip every pending URL of a host
//   node dataset/scripts/queue.mjs stats                           counts by status and by host
// All changes are applied atomically under the queue lock (safe with parallel sessions).
import fs from 'node:fs';
import { loadQueue, updateQueue, addUrls, die } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'add': {
    const urls = args[0] === '--file' ? fs.readFileSync(args[1], 'utf8').split(/\r?\n/).filter(Boolean) : args;
    const { n, size } = await updateQueue((q) => ({ n: addUrls(q, urls), size: Object.keys(q).length }));
    console.log(`added ${n} new URL(s); queue size ${size}`);
    break;
  }
  case 'skip': {
    const [url, ...reason] = args;
    const found = await updateQueue((q) => {
      if (!q[url]) return false;
      q[url] = { ...q[url], s: 'skip', t: Date.now(), r: reason.join(' ') || 'skipped' };
      return true;
    });
    if (!found) die(`not in queue: ${url}`);
    console.log('skipped');
    break;
  }
  case 'block-host': {
    const [host, ...reason] = args;
    const n = await updateQueue((q) => {
      let count = 0;
      for (const [url, e] of Object.entries(q))
        if (e.h === host && (e.s === 'pending' || e.s === 'taken')) {
          q[url] = { ...e, s: 'skip', t: Date.now(), r: `host blocked: ${reason.join(' ')}` };
          count++;
        }
      return count;
    });
    console.log(`skipped ${n} URL(s) of ${host}`);
    break;
  }
  case 'stats': {
    const q = loadQueue();
    const byStatus = {};
    const byHost = {};
    for (const e of Object.values(q)) {
      byStatus[e.s] = (byStatus[e.s] || 0) + 1;
      const h = (byHost[e.h] ||= {});
      h[e.s] = (h[e.s] || 0) + 1;
    }
    console.log(JSON.stringify({ total: Object.keys(q).length, byStatus, byHost }, null, 1));
    break;
  }
  default:
    die('usage: queue.mjs add|skip|block-host|stats ...');
}
