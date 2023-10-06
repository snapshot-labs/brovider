import mysql from 'mysql2/promise';
import { ConnectionString } from 'connection-string';
export { OkPacket, FieldPacket } from 'mysql2/promise';

const { protocol, hosts, path, ...config } = new ConnectionString(process.env.DATABASE_URL || '');
const db: mysql.Pool = mysql.createPool({
  ...config,
  host: hosts?.[0].name,
  port: hosts?.[0].port,
  connectionLimit: parseInt(process.env.CONNECTION_LIMIT || '10'),
  multipleStatements: true,
  connectTimeout: 60e3,
  waitForConnections: true,
  charset: 'utf8mb4',
  database: path?.[0],
  queueLimit: 0
});

export default db;
