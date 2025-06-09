const ANKR_KEY = process.env.ANKR_KEY || '';
const INFURA_KEY = process.env.INFURA_KEY || '';
const DRPC_KEY = process.env.DRPC_KEY || '';
const FILECOIN_KEY = process.env.FILECOIN_KEY || '';

const keys = [
  { id: 'ANKR_KEY', value: ANKR_KEY },
  { id: 'INFURA_KEY', value: INFURA_KEY },
  { id: 'DRPC_KEY', value: DRPC_KEY },
  { id: 'FILECOIN_KEY', value: FILECOIN_KEY }
];

export function getNodeUrl(baseUrl: string): string {
  return keys.reduce((url, key) => url.replace(`\${${key.id}}`, key.value), baseUrl);
}
