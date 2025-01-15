const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('keyboard_stats.db');
const { ipcRenderer } = require('electron');

// 创建表格
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    count INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// 用于存储每 30 秒的数据
let dataMap = new Map();
let frequencyData = []; // 用于存储频率数据

// 每 30 秒更新数据
setInterval(() => {
  // 处理数据分析
  analyzeData();
  // 清空 Map
  dataMap.clear();
}, 30000);

// 数据分析函数
function analyzeData() {
  // 在这里进行数据分析
  dataMap.forEach((count, key) => {
    // 将数据存储到 SQLite 数据库
    db.run(`INSERT INTO stats (key, count) VALUES (?, ?)`, [key, count], function(err) {
      if (err) {
        return console.error(err.message);
      }
      console.log(`已插入数据: ${key} - ${count}`);
    });

    // 更新频率数据
    frequencyData.push({ key, count });
  });

  // 发送频率数据到前端
  if (frequencyData.length > 0) {
    // 使用 IPC 发送数据到前端
    ipcRenderer.send('updateFrequencyData', frequencyData);
  }
}

// 监听键盘事件
process.stdin.on('keypress', (str, key) => {
  // 处理按键逻辑
  let keyName = key.name || str.toUpperCase();
  
  // 更新 Map
  dataMap.set(keyName, (dataMap.get(keyName) || 0) + 1);

  // 更新统计数据
  this.stats.keyboard.keyPresses[keyName] = (this.stats.keyboard.keyPresses[keyName] || 0) + 1;
  this.stats.keyboard.totalPresses++;

  const now = Date.now();
  if (this.stats.keyboard.lastPressTime) {
    const interval = now - this.stats.keyboard.lastPressTime;
    this.stats.keyboard.pressIntervals.push(interval);
  }
  this.stats.keyboard.lastPressTime = now;

  // 更新平均速度和间隔
  updateSummary();
});

// 更新统计摘要
function updateSummary() {
  const now = Date.now();
  const timeDiff = now - this.stats.summary.startTime;

  this.stats.keyboard.averageSpeed = 
    (this.stats.keyboard.totalPresses / timeDiff) * 60000; // 每分钟按键数

  this.stats.keyboard.averageInterval = 
    this.stats.keyboard.pressIntervals.length > 0
      ? this.stats.keyboard.pressIntervals.reduce((a, b) => a + b, 0) / 
        this.stats.keyboard.pressIntervals.length
      : 0;

  this.stats.summary.totalTime = timeDiff;
}

// 每小时将数据存储到 SQLite 数据库
setInterval(() => {
  // 这里可以添加每小时的逻辑
  console.log('每小时存储数据到数据库');
}, 3600000);