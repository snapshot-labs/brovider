import mysql from 'mysql2/promise';

const config = process.env.DATABASE_URL_V8 || '';
const db = mysql.createPool(config);

export default db;
