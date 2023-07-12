import db from './init';

function getUnarchivedNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network != '' AND archive = 1`);
}

function setNodeAsArchive(state: boolean, node) {
  return db.query('UPDATE nodes SET archive = ? WHERE url = ?', [Number(state), node.url]);
}

function loadUndefinedNodes(): Promise<any[]> {
  return db.query(`SELECT * FROM nodes WHERE network <= 0`);
}

function setNetwork(node, network) {
  return db.query('UPDATE nodes SET network = ? WHERE url = ?', [network, node.url]);
}

function setUndefinedNetwork(node) {
  return db.query('UPDATE nodes SET network = 0 WHERE url = ?', [node.url]);
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
  getUnarchivedNodes,
  setNodeAsArchive,
  loadUndefinedNodes,
  setNetwork,
  setUndefinedNetwork,
  loadValidNodes,
  incErrors,
  incDuration
};
