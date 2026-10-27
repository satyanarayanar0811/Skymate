import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'mysql',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'airline',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'airline',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
  queueLimit: 0,
  decimalNumbers: true,
  enableKeepAlive: true,
  timezone: 'Z'
});
