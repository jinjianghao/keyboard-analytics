const { app, BrowserWindow, ipcMain } = require('electron');
const { GlobalKeyboardListener } = require('node-global-key-listener');
const { uIOhook } = require('uiohook-napi');
const { handleKeyPress, getDailyStats, handleMouseEvent } = require('./index.js');
const { spawn } = require('child_process'); // 新增
let pyProc = null; // 新增

const keyCodeToStringNormal = {
  29: "0",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  23: "5",
  22: "6",
  26: "7",
  28: "8",
  25: "9",
  0: "A",
  11: "B",
  8: "C",
  2: "D",
  14: "E",
  3: "F",
  5: "G",
  4: "H",
  34: "I",
  38: "J",
  40: "K",
  37: "L",
  46: "M",
  45: "N",
  31: "O",
  35: "P",
  12: "Q",
  15: "R",
  1: "S",
  17: "T",
  32: "U",
  9: "V",
  13: "W",
  7: "X",
  16: "Y",
  6: "Z",
  10: "SectionSign",
  50: "Grave",
  27: "Minus",
  24: "Equal",
  33: "LeftBracket",
  30: "RightBracket",
  41: "Semicolon",
  39: "Quote",
  43: "Comma",
  47: "Period",
  44: "Slash",
  42: "Backslash",
  82: "Keypad0",
  83: "Keypad1",
  84: "Keypad2",
  85: "Keypad3",
  86: "Keypad4",
  87: "Keypad5",
  88: "Keypad6",
  89: "Keypad7",
  91: "Keypad8",
  92: "Keypad9",
  65: "KeypadDecimal",
  67: "KeypadMultiply",
  69: "KeypadPlus",
  75: "KeypadDivide",
  78: "KeypadMinus",
  81: "KeypadEquals",
  71: "KeypadClear",
  76: "KeypadEnter",
  49: "Space",
  36: "Return",
  48: "Tab",
  51: "Delete",
  117: "ForwardDelete",
  52: "Linefeed",
  53: "Escape",
  122: "F1",
  120: "F2",
  99: "F3",
  118: "F4",
  96: "F5",
  97: "F6",
  98: "F7",
  100: "F8",
  101: "F9",
  109: "F10",
  103: "F11",
  111: "F12",
  105: "F13",
  107: "F14",
  113: "F15",
  106: "F16",
  64: "F17",
  79: "F18",
  80: "F19",
  90: "F20",
  72: "VolumeUp",
  73: "VolumeDown",
  74: "Mute",
  114: "Help/Insert",
  115: "Home",
  119: "End",
  116: "PageUp",
  121: "PageDown",
  123: "Arrow Left",
  124: "Arrow Right",
  125: "Arrow Down",
  126: "Arrow Up",
  145: "Brightness Down",
  144: "Brightness Up",
  130: "Dashboard",
  131: "LaunchPad"
};

const keyCodeToStringModifier = {
  54: "RightCommand",
  55: "Command",
  56: "Shift",
  57: "CapsLock",
  58: "Option",
  59: "Control",
  60: "RightShift",
  61: "RightOption",
  62: "RightControl",
  63: "Function"
};
// 添加对数据分析存储的支持
require('./index.js');

// 添加对 NSApplicationDelegate 的支持
app.applicationSupportsSecureRestorableState = true;

// 添加这个配置来处理输入法问题
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'IMEBasedTextInput');
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
    
    keyboard.addListener(function(e, down) {
      if (e.name && e.name.toLowerCase().includes('mouse')) return;
      if (e.state === 'DOWN') return;
      if (down) {
        let keyName = keyCodeToStringNormal[e.keyCode] || keyCodeToStringModifier[e.keyCode] || e.name;
        console.log(keyName);
        
        if (keyName) {
          mainWindow.webContents.send('keyEvent', {
            type: 'keyboard',
            key: keyName
          });
          
          handleKeyPress(keyName);
        } else {
          console.warn(`未定义的按键: ${e.keyCode}`);
        }
      }
    });

    // 鼠标事件监听sss
    uIOhook.on('mousedown', (e) => {
      let buttonName;
      switch (e.button) {
        case 1:
          buttonName = 'Left';
          break;
        case 2:
          buttonName = 'Right';
          break;
        case 3:
          buttonName = 'Middle';
          break;
        default:
          return; // 忽略其他按钮
      }
      
      handleMouseEvent(buttonName); // 新增：统计鼠标事件

      // 发送事件到渲染进程
      try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('mouseEvent', {
            type: 'mouse',
            name: buttonName,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('发送鼠标事件失败:', error);
      }
    });

    // 启动 uIOhook
    uIOhook.start();

    console.log('键盘和鼠标监听器已启动');

    // 添加 IPC 监听器
    ipcMain.handle('get-daily-stats', async () => {
      try {
        return await getDailyStats();
      } catch (error) {
        console.error('获取每日统计失败:', error);
        return null;
      }
    });

  } catch (error) {
    console.error('监听器初始化失败:', error);
  }

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();
}

// 处理应用程序启动
app.whenReady()
  .then(() => {
    // // 启动 Python AI 服务
    // pyProc = spawn('python3', ['ai/your_api_server.py'], {
    //   cwd: __dirname,
    //   stdio: 'ignore',
    //   detached: true
    // });
    createWindow();
  })
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
  try {
    if (pyProc) pyProc.kill(); // 新增
    uIOhook.stop();
  } catch (error) {
    console.error('清理资源失败:', error);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});