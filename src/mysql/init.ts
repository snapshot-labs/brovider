import mysql from 'mysql2/promise';
import { ConnectionString } from 'connection-string';
export { OkPacket, FieldPacket } from 'mysql2/promise';

const config = new ConnectionString(process.env.DATABASE_URL || '');
const db: mysql.Pool = mysql.createPool({
  ...config,
  host: config.hosts?.[0].name,
  port: config.hosts?.[0].port,
  connectionLimit: parseInt(process.env.CONNECTION_LIMIT || '10'),
  multipleStatements: true,
  connectTimeout: 60e3,
  acquireTimeout: 60e3,
  waitForConnections: true,
  charset: 'utf8mb4',
  database: config.path?.[0],
  queueLimit: 0
});

export default db;
