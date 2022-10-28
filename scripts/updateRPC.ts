// eslint-disable-next-line @typescript-eslint/no-var-requires
const rpcs = require('../src/rpcs.json');
const https = require('https');

const args = process.argv.slice(2);
if (args.length === 2) {
  const chainId = args[0];
  const rpc = args[1];
  if (!rpcs[chainId]) rpcs[chainId] = [];
  rpcs[chainId] = [...new Set([rpc, ...rpcs[chainId]])];
  console.log(rpcs[chainId]);
  // update rpcs.json file with new rpc
  require('fs').writeFileSync('src/rpcs.json', JSON.stringify(rpcs, null, 2), 'utf8');
} else {
  // get networks.json file from https://raw.githubusercontent.com/snapshot-labs/snapshot.js/master/src/networks.json
  https.get(
    'https://raw.githubusercontent.com/snapshot-labs/snapshot.js/master/src/networks.json',
    res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        const networks = JSON.parse(data);
        // update only networks that are not in rpcs.json or removed from networks.json
        Object.keys(networks).forEach(chainId => {
          if (!rpcs[chainId]) {
            rpcs[chainId] = networks[chainId].rpc;
          }
        });
        Object.keys(rpcs).forEach(chainId => {
          if (!networks[chainId]) {
            delete rpcs[chainId];
          }
        });
        // update rpcs.json file with new rpc
        require('fs').writeFileSync('src/rpcs.json', JSON.stringify(rpcs, null, 2), 'utf8');
        console.log('rpcs.json updated');
      });
    }
  );
}
