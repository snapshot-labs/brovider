import rpcs from '../src/rpcs.json';

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
  console.log('Usage: updateRPC.js <rpc> <network>');
}
