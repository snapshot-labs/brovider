import db, { OkPacket, FieldPacket } from './init';

function getUnknownArchiveNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network != '' AND archive = -1`);
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

function loadNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes`);
}

type NodeBase = {
  url: string;
  provider: string;
};
async function addNodes(nodes: NodeBase[]): Promise<OkPacket> {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return Promise.resolve({} as OkPacket);
  }

  const query = `
    INSERT INTO nodes (url, provider, network, archive, requests, errors, duration, created)
    VALUES ?
  `;

  const values = nodes.map(({ url, provider }) => {
    return [url, provider, '-1', -1, 0, 0, 0, +new Date() / 1e3];
  });

  const [result] = (await db.query(query, [values])) as [OkPacket, FieldPacket[]];
  return result;
}

async function deleteNode(nodeUrl: string): Promise<OkPacket> {
  const query = `DELETE FROM nodes WHERE url = ? LIMIT 1`;
  const [result] = (await db.query(query, [nodeUrl])) as [OkPacket, FieldPacket[]];
  return result;
}

type NodeUpdate = {
  url: string;
  provider: string;
  requests: number;
  errors: number;
  duration: number;
};
async function updateNode(node: NodeUpdate): Promise<OkPacket> {
  const { url, provider, requests, errors, duration } = node;
  const query = `
    UPDATE nodes
    SET provider = ?, requests = ?, errors = ?, duration = ?
    WHERE url = ?
    LIMIT 1
  `;

  const [result] = (await db.query(query, [provider, requests, errors, duration, url])) as [
    OkPacket,
    FieldPacket[]
  ];
  return result;
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
  return db.query(`SELECT * FROM nodes WHERE network > 0 AND archive >= 0`);
}

function incErrors(node) {
  const query = 'UPDATE nodes SET requests = requests + 1, errors = errors + 1 WHERE url = ?';
  return db.query(query, [node.url]);
}

function incDuration(node, duration) {
  const query = 'UPDATE nodes SET requests = requests + 1, duration = duration + ? WHERE url = ?';
  return db.query(query, [duration, node.url]);
}

export { db };

export default {
  getUnknownArchiveNodes,
  setArchiveNodes,
  loadNodes,
  addNodes,
  deleteNode,
  updateNode,
  setNetworkChainIds,
  loadValidNodes,
  incErrors,
  incDuration
};
