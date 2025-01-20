// createDatabase.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('keyboard_stats.db');

// 创建表格
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    count INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('表格已创建或已存在');
    }
  });
});

// 关闭数据库连接
db.close();