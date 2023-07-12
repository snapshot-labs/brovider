import mysql from 'mysql2/promise';
export { OkPacket, FieldPacket } from 'mysql2/promise';

const config = process.env.DATABASE_URL || '';
const db = mysql.createPool(config);

export default db;
