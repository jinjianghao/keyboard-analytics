const readline = require('readline');
const fs = require('fs');

// 初始化统计对象
const stats = {
  keyPresses: {},
  combinationPresses: {},  // 新增：组合键统计
  totalPresses: 0,
  startTime: new Date(),
  lastPressTime: null,     // 新增：记录上次按键时间
  pressIntervals: [],      // 新增：记录按键间隔
};

// 设置 readline
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

// 监听键盘事件
process.stdin.on('keypress', (str, key) => {
  // 如果按下 Ctrl+C，保存并退出
  if (key.ctrl && key.name === 'c') {
    saveStats();
    console.log('\n数据已保存，程序退出');
    process.exit();
  }

  const now = new Date();
  
  // 记录按键间隔
  if (stats.lastPressTime) {
    const interval = now - stats.lastPressTime;
    stats.pressIntervals.push(interval);
  }
  stats.lastPressTime = now;

  // 构建按键名称
  let keyName = '';
  if (key.ctrl) keyName += 'Ctrl+';
  if (key.alt) keyName += 'Alt+';
  if (key.shift) keyName += 'Shift+';
  if (key.meta) keyName += 'Meta+';
  
  // 处理特殊键
  if (key.name) {
    keyName += key.name.toUpperCase();
  } else if (str) {
    keyName += str.toUpperCase();
  }

  // 更新按键统计
  if (keyName.includes('+')) {
    // 组合键统计
    stats.combinationPresses[keyName] = (stats.combinationPresses[keyName] || 0) + 1;
  } else {
    // 单键统计
    stats.keyPresses[keyName] = (stats.keyPresses[keyName] || 0) + 1;
  }
  
  stats.totalPresses++;
  
  // 显示按下的键
  console.log(`按下键: ${keyName}`);
  
  // 每10次按键保存一次数据并显示简要统计
  if (stats.totalPresses % 10 === 0) {
    saveStats();
    showStats();
  }
});

// 显示统计信息
function showStats() {
  console.log('\n--- 按键统计摘要 ---');
  console.log(`总按键次数: ${stats.totalPresses}`);
  
  // 计算平均按键间隔
  if (stats.pressIntervals.length > 0) {
    const avgInterval = stats.pressIntervals.reduce((a, b) => a + b, 0) / stats.pressIntervals.length;
    console.log(`平均按键间隔: ${Math.round(avgInterval)}ms`);
  }
  
  // 显示最常用的5个键
  const sortedKeys = Object.entries(stats.keyPresses)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);
  
  console.log('\n最常用的键:');
  sortedKeys.forEach(([key, count]) => {
    console.log(`${key}: ${count}次`);
  });
  console.log('-------------------\n');
}

// 保存统计数据
function saveStats() {
  const data = {
    ...stats,
    endTime: new Date(),
    summary: {
      totalTime: new Date() - stats.startTime,
      averageSpeed: stats.totalPresses / ((new Date() - stats.startTime) / 1000 / 60), // 每分钟按键数
      averageInterval: stats.pressIntervals.length > 0 
        ? stats.pressIntervals.reduce((a, b) => a + b, 0) / stats.pressIntervals.length 
        : 0
    }
  };
  
  // 删除不需要保存的临时数据
  delete data.lastPressTime;
  
  fs.writeFileSync(
    'keyboard-stats.json',
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

console.log('键盘统计程序已启动...');
console.log('按 Ctrl+C 退出程序'); 