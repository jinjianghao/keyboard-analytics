const { app, BrowserWindow } = require('electron');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const { uIOhook } = require('uiohook-napi');

// 添加对 NSApplicationDelegate 的支持
app.applicationSupportsSecureRestorableState = true;

// 添加这个配置来处理输入法问题
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'IMEBasedTextInput');
}

class KeyStatsCollector {
  // ... 保持原有代码不变 ...
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  try {
    // 初始化键盘监听
    const keyboard = new GlobalKeyboardListener();
    
    // 键盘事件监听
    keyboard.addListener(function(e, down) {
      // 过滤掉鼠标事件
      if (e.name && e.name.toLowerCase().includes('mouse')) {
        return;
      }
      // 过滤掉松开事件
      if (e.state === 'DOWN') {
        return;
      }
      if (down) {  // 确保只处理按下事件
        let keyName = e.name;
        if (keyName) { // 确保 keyName 已定义
          if (e.state.ctrl) keyName = 'Ctrl+' + keyName;
          if (e.state.alt) keyName = 'Alt+' + keyName;
          if (e.state.shift) keyName = 'Shift+' + keyName;
          if (e.state.meta) keyName = 'Meta+' + keyName;

          mainWindow.webContents.send('keyEvent', {
            type: 'keyboard',
            key: keyName,
            timestamp: Date.now()
          });
        } else {
          console.warn('未定义的键名:', e);
        }
      }
    });

    // 鼠标事件监听sss
    uIOhook.on('mousedown', (e) => {
      let buttonName;
      switch (e.button) {
        case 1:
          buttonName = '左键';
          break;
        case 2:
          buttonName = '右键';
          break;
        case 3:
          buttonName = '中键';
          break;
        default:
          return; // 忽略其他按钮
      }

      mainWindow.webContents.send('mouseEvent', {
        type: 'mouse',
        name: buttonName,
        timestamp: Date.now()
      });
    });

    // 确保只在鼠标按下时发送事件
    uIOhook.on('mouseup', () => {
      // 不处理鼠标抬起事件
    });

    // 启动 uIOhook
    uIOhook.start();

    console.log('键盘和鼠标监听器已启动');
  } catch (error) {
    console.error('监听器初始化失败:', error);
  }

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

// 处理应用程序启动
app.whenReady()
  .then(createWindow)
  .catch(error => {
    console.error('应用启动失败:', error);
  });

// 处理窗口激活
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 处理窗口关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 清理资源
app.on('before-quit', () => {
  uIOhook.stop();
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});