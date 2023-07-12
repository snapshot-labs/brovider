import db, { OkPacket, FieldPacket } from './init';

function getArchiveNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network != '' AND archive = 1`);
}

type ArchiveNodeMapItem = {
  node: any;
  archive: boolean;
};
async function setArchiveNodes(nodes: ArchiveNodeMapItem[]): Promise<OkPacket> {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return Promise.resolve({} as OkPacket);
  }

  const caseQueryPart = nodes
    .map(({ node, archive }) => `WHEN '${node.url}' THEN ${Number(archive)}`)
    .join(' ');
  const whereInQueryPart = nodes.map(({ node }) => `'${node.url}'`).join(', ');

  const query = `
    UPDATE nodes
    SET archive = CASE url
      ${caseQueryPart}
      ELSE archive
    END
    WHERE url IN (${whereInQueryPart})
  `;

  const [result] = (await db.query(query)) as [OkPacket, FieldPacket[]];
  return result;
}

function loadNodesWithoutChainId(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network <= 0`);
}

type NetworkChainIdMapItem = {
  node: any;
  chainId: number;
};
async function setNetworkChainIds(nodes: NetworkChainIdMapItem[]): Promise<OkPacket> {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return Promise.resolve({} as OkPacket);
  }

  const caseQueryPart = nodes
    .map(({ node, chainId }) => `WHEN '${node.url}' THEN ${chainId}`)
    .join(' ');
  const whereInQueryPart = nodes.map(({ node }) => `'${node.url}'`).join(', ');

  const query = `
    UPDATE nodes
    SET network = CASE url
      ${caseQueryPart}
      ELSE network
    END
    WHERE url IN (${whereInQueryPart})
  `;

  const [result] = (await db.query(query)) as [OkPacket, FieldPacket[]];
  return result;
}

function loadValidNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network > 0 AND archive = 1`);
}

function incErrors(node) {
  const query = 'UPDATE nodes SET requests = requests + 1, errors = errors + 1 WHERE url = ?';
  return db.query(query, [node.url]);
}

function incDuration(node, duration) {
  const query = 'UPDATE nodes SET requests = requests + 1, duration = duration + ? WHERE url = ?';
  return db.query(query, [duration, node.url]);
}

export default {
  db,
  getArchiveNodes,
  setArchiveNodes,
  loadNodesWithoutChainId,
  setNetworkChainIds,
  loadValidNodes,
  incErrors,
  incDuration
};
