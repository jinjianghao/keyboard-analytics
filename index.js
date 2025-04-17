const sqlite3 = require('sqlite3').verbose();
const { ipcRenderer } = require('electron');

// 1. 新增 mouse_events 表
const DB_CONFIG = {
  path: 'keyboard_stats.db',
  tables: {
    normal_keys: `CREATE TABLE IF NOT EXISTS normal_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      count INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    shortcut_keys: `CREATE TABLE IF NOT EXISTS shortcut_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      combination TEXT NOT NULL UNIQUE,
      count INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    mouse_events: `CREATE TABLE IF NOT EXISTS mouse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      button TEXT NOT NULL UNIQUE,
      count INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  }
};

// 常量配置
const CONSTANTS = {
  NORMAL_CACHE_THRESHOLD: 5,    // 普通按键缓存阈值
  SHORTCUT_CACHE_THRESHOLD: 5,   // 快捷键缓存阈值
  SYNC_INTERVAL: 30000,          // 同步间隔（30秒）
  SPECIAL_KEYS: ['Ctrl', 'Shift', 'Alt', 'Command']
};

class KeyboardStatsManager {
  constructor() {
    console.log('初始化 KeyboardStatsManager...');
    // 1. 连接数据库
    this.db = new sqlite3.Database(DB_CONFIG.path, (err) => {
      if (err) {
        console.error('数据库连接失败:', err.message);
      } else {
        console.log('数据库连接成功:', DB_CONFIG.path);
      }
    });
    
    // 2. 初始化缓存
    this.normalKeyCache = new Map();     // 普通按键缓存
    this.shortcutKeyCache = new Map();   // 快捷键缓存
    this.mouseEventCache = new Map();    // 鼠标事件缓存
    
    // 3. 创建数据库表
    this.initializeDatabase();
    
    // 4. 设置定时同步任务
    this.setupIntervals();
    console.log('KeyboardStatsManager 初始化完成');
  }

  // 初始化数据库
  initializeDatabase() {
    console.log('开始初始化数据库表...');
    this.db.serialize(() => {
      Object.entries(DB_CONFIG.tables).forEach(([tableName, query]) => {
        console.log(`创建表 ${tableName}...`);
        this.db.run(query, (err) => {
          if (err) {
            console.error(`创建表 ${tableName} 失败:`, err.message);
          } else {
            console.log(`表 ${tableName} 创建成功`);
          }
        });
      });
    });
  }

  // 设置定时同步
  setupIntervals() {
    console.log(`设置定时同步任务，间隔: ${CONSTANTS.SYNC_INTERVAL}ms`);
    setInterval(() => {
      console.log('执行定时同步任务...');
      this.syncData();
    }, CONSTANTS.SYNC_INTERVAL);
  }

  // 处理按键事件
  async handleKeyPress(keyName) {
    const isShortcut = this.isShortcutKey(keyName);
    const cache = isShortcut ? this.shortcutKeyCache : this.normalKeyCache;
    const threshold = isShortcut ? CONSTANTS.SHORTCUT_CACHE_THRESHOLD : CONSTANTS.NORMAL_CACHE_THRESHOLD;
    const keyType = isShortcut ? '快捷键' : '普通按键';

    // 更新缓存
    const prevCount = cache.get(keyName) || 0;
    cache.set(keyName, prevCount + 1);
    console.log(`接收到${keyType}: ${keyName}, 累计次数: ${prevCount + 1}`);

    // 输出缓存状态
    console.log(`当前${keyType}缓存大小: ${cache.size}/${threshold}`);
    
    // 检查是否需要同步到数据库
    if (cache.size >= threshold) {
      console.log(`${keyType}缓存达到阈值 ${threshold}，开始同步数据...`);
      await this.syncCacheToDatabase(isShortcut);
    }
  }

  // 新增 handleMouseEvent 方法
  async handleMouseEvent(buttonName) {
    const prevCount = this.mouseEventCache.get(buttonName) || 0;
    this.mouseEventCache.set(buttonName, prevCount + 1);
    console.log(`接收到鼠标事件: ${buttonName}, 累计次数: ${prevCount + 1}`);

    // 缓存阈值可复用普通按键的
    if (this.mouseEventCache.size >= CONSTANTS.NORMAL_CACHE_THRESHOLD) {
      console.log(`鼠标事件缓存达到阈值，开始同步数据...`);
      await this.syncMouseCacheToDatabase();
    }
  }

  // 4. 新增 syncMouseCacheToDatabase
  async syncMouseCacheToDatabase() {
    const cache = this.mouseEventCache;
    const tableName = 'mouse_events';
    const keyColumn = 'button';

    try {
      await this.beginTransaction();
      for (const [button, count] of cache.entries()) {
        await this.updateKeyCount(tableName, keyColumn, button, count);
      }
      await this.commitTransaction();
      cache.clear();
    } catch (error) {
      await this.rollbackTransaction();
      console.error('同步鼠标数据失败:', error);
    }
  }

  // 判断是否为快捷键
  isShortcutKey(keyName) {
    const isShortcut = keyName.includes('+') || 
                      CONSTANTS.SPECIAL_KEYS.some(specialKey => keyName.includes(specialKey));
    console.log(`按键类型检查: ${keyName} -> ${isShortcut ? '快捷键' : '普通按键'}`);
    return isShortcut;
  }

  // 同步缓存到数据库
  async syncCacheToDatabase(isShortcut) {
    // 1. 确定要操作的表和缓存
    const cache = isShortcut ? this.shortcutKeyCache : this.normalKeyCache;
    const tableName = isShortcut ? 'shortcut_keys' : 'normal_keys';
    const keyColumn = isShortcut ? 'combination' : 'key';
    
    try {
      // 2. 开始事务
      await this.beginTransaction();
      
      // 3. 遍历缓存数据并更新数据库
      for (const [key, count] of cache.entries()) {
        await this.updateKeyCount(tableName, keyColumn, key, count);
      }
      
      // 4. 提交事务
      await this.commitTransaction();
      
      // 5. 清空已同步的缓存
      cache.clear();
    } catch (error) {
      // 6. 错误处理：回滚事务
      await this.rollbackTransaction();
    }
  }

  // 更新按键计数
  async updateKeyCount(tableName, keyColumn, key, count) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO ${tableName} (${keyColumn}, count, timestamp)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(${keyColumn}) DO UPDATE SET 
        count = count + ?,
        timestamp = datetime('now')
        WHERE ${keyColumn} = ?
      `;

      console.log(`执行SQL: ${query.replace(/\s+/g, ' ')}`);
      console.log(`参数: [${key}, ${count}, ${count}, ${key}]`);

      this.db.run(query, [key, count, count, key], (err) => {
        if (err) {
          console.error(`更新${tableName}失败:`, err);
          reject(err);
        } else {
          console.log(`成功更新 ${tableName}: ${key} -> ${count}`);
          resolve();
        }
      });
    });
  }

  // 事务控制方法
  beginTransaction() {
    return new Promise((resolve, reject) => {
      console.log('开始新事务...');
      this.db.run('BEGIN TRANSACTION', err => {
        if (err) {
          console.error('开始事务失败:', err);
          reject(err);
        } else {
          console.log('事务开始成功');
          resolve();
        }
      });
    });
  }

  commitTransaction() {
    return new Promise((resolve, reject) => {
      console.log('提交事务...');
      this.db.run('COMMIT', err => {
        if (err) {
          console.error('提交事务失败:', err);
          reject(err);
        } else {
          console.log('事务提交成功');
          resolve();
        }
      });
    });
  }

  rollbackTransaction() {
    return new Promise((resolve, reject) => {
      console.log('回滚事务...');
      this.db.run('ROLLBACK', err => {
        if (err) {
          console.error('回滚事务失败:', err);
          reject(err);
        } else {
          console.log('事务回滚成功');
          resolve();
        }
      });
    });
  }

  // 定时同步所有数据
  syncData() {
    console.log('执行定时同步检查...');
    
    if (this.normalKeyCache.size > 0) {
      console.log(`发现 ${this.normalKeyCache.size} 个普通按键待同步`);
      this.syncCacheToDatabase(false);
    } else {
      console.log('没有普通按键需要同步');
    }

    if (this.shortcutKeyCache.size > 0) {
      console.log(`发现 ${this.shortcutKeyCache.size} 个快捷键待同步`);
      this.syncCacheToDatabase(true);
    } else {
      console.log('没有快捷键需要同步');
    }

    if (this.mouseEventCache.size > 0) {
      console.log(`发现 ${this.mouseEventCache.size} 个鼠标事件待同步`);
      this.syncMouseCacheToDatabase();
    } else {
      console.log('没有鼠标事件需要同步');
    }
  }

  // 添加获取当天数据的方法
  async getDailyStats() {
    return new Promise((resolve, reject) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const query = `
        SELECT 
          n.key as key,
          n.count as count,
          'normal' as type
        FROM normal_keys n
        WHERE DATE(n.timestamp) = DATE('now', 'localtime')
        UNION ALL
        SELECT 
          s.combination as key,
          s.count as count,
          'shortcut' as type
        FROM shortcut_keys s
        WHERE DATE(s.timestamp) = DATE('now', 'localtime')
      `;

      this.db.all(query, [], (err, rows) => {
        if (err) {
          console.error('获取当天数据失败:', err);
          reject(err);
        } else {
          const stats = {
            keyPresses: {},
            combinationPresses: {},
            totalPresses: 0
          };

          rows.forEach(row => {
            if (row.type === 'normal') {
              stats.keyPresses[row.key] = row.count;
              stats.totalPresses += row.count;
            } else {
              stats.combinationPresses[row.key] = row.count;
            }
          });

          resolve(stats);
        }
      });
    });
  }
}

// 创建并导出实例
console.log('创建 KeyboardStatsManager 实例...');
const keyboardStats = new KeyboardStatsManager();
console.log('KeyboardStatsManager 实例创建完成');

module.exports = {
  handleKeyPress: keyboardStats.handleKeyPress.bind(keyboardStats),
  getDailyStats: keyboardStats.getDailyStats.bind(keyboardStats),
  handleMouseEvent: keyboardStats.handleMouseEvent.bind(keyboardStats)
};