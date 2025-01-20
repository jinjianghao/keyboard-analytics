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

let nonComboKeyCache = new Map();
const CACHE_THRESHOLD = 50; // 设置缓存阈值

// 数据分析函数
function analyzeData() {
  console.log('分析数据...'); // 确认函数被调用
  console.log('当前数据:', Array.from(dataMap)); // 查看 dataMap 的内容

  dataMap.forEach((count, key) => {
    // 检测快捷键组合
    let shortcutKey = '';
    if (key.includes('+')) {
      shortcutKey = key; // 如果已经是组合键
    } else {
      // 检测是否有特殊键
      if (key.includes('Ctrl')) {
        shortcutKey = 'Ctrl+' + key.replace('Ctrl+', '');
      } else if (key.includes('Shift')) {
        shortcutKey = 'Shift+' + key.replace('Shift+', '');
      } else if (key.includes('Alt')) {
        shortcutKey = 'Alt+' + key.replace('Alt+', '');
      }
    }

    // 如果是组合快捷键，直接插入数据库
    if (shortcutKey) {
      db.run(`INSERT INTO stats (key, count) VALUES (?, ?)`, [shortcutKey, count], function(err) {
        if (err) {
          return console.error('插入错误:', err.message);
        }
        console.log(`已插入数据: ${shortcutKey} - ${count}`);
      });
    } else {
      // 如果是非组合快捷键，缓存到 Map
      nonComboKeyCache.set(key, (nonComboKeyCache.get(key) || 0) + count);

      // 检查缓存长度是否达到阈值
      if (nonComboKeyCache.size >= CACHE_THRESHOLD) {
        // 批量插入缓存数据
        const insertPromises = [];
        nonComboKeyCache.forEach((cachedCount, cachedKey) => {
          insertPromises.push(new Promise((resolve, reject) => {
            db.run(`INSERT INTO stats (key, count) VALUES (?, ?)`, [cachedKey, cachedCount], function(err) {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          }));
        });

        // 等待所有插入完成后清空缓存
        Promise.all(insertPromises)
          .then(() => {
            console.log('批量插入非组合快捷键数据完成');
            nonComboKeyCache.clear(); // 清空缓存
          })
          .catch(err => {
            console.error('批量插入错误:', err.message);
          });
      }
    }
  });

  // 发送频率数据到前端
  if (frequencyData.length > 0) {
    ipcRenderer.send('updateFrequencyData', frequencyData);
    frequencyData = [];
  }
}

// 监听键盘事件
process.stdin.on('keypress', (str, key) => {
  // 处理按键逻辑
  let keyName = key.name || str.toUpperCase();
  
  // 更新 Map
  dataMap.set(keyName, (dataMap.get(keyName) || 0) + 1);

  // 确保 this.stats 被正确初始化
  if (!this.stats) {
    this.stats = {
      keyboard: {
        keyPresses: {},
        totalPresses: 0,
        pressIntervals: [],
        lastPressTime: null,
      },
      summary: {
        startTime: Date.now(),
        totalTime: 0,
      },
    };
  }

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