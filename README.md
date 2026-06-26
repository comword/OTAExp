# OTAExp

基于 **Expo / React Native** 的蓝牙 BLE OTA（固件无线升级）示例工程。OTA 的协议算法由一个**纯 C++ Turbo Native Module** 实现，App 侧通过 `react-native-ble-plx` 负责蓝牙收发，配套提供 ESP32 设备端固件。

整个仓库是一个 **pnpm 工作区（monorepo）**，包含移动端 App、可复用的原生模块库，以及设备固件工程。

---

## 目录结构

```
OTAExp/
├── apps/
│   ├── OTAExp/                 # Expo App（移动端）
│   │   ├── android/            # 原生 Android 工程（gradlew 在此目录）
│   │   ├── ios/                # 原生 iOS 工程
│   │   ├── src/
│   │   │   ├── app/            # 路由页面（expo-router）
│   │   │   │   ├── index.tsx   #   首页
│   │   │   │   ├── explore.tsx #   示例页
│   │   │   │   ├── scan.tsx    #   设备扫描 / 连接页
│   │   │   │   └── ota.tsx     #   OTA 升级页
│   │   │   ├── components/     # UI 组件
│   │   │   ├── services/
│   │   │   │   ├── ble/        # 共享 BLE 会话（扫描、连接，单例 BleManager）
│   │   │   │   └── ota/        # OTA 传输客户端（驱动 C++ 引擎）
│   │   │   ├── constants/      # 主题、间距等常量
│   │   │   └── hooks/          # 自定义 hooks
│   │   └── app.json            # Expo 配置（插件、权限等）
│   └── hwt605-bt-pio/          # ESP32 设备端固件（PlatformIO）
│       ├── src/main.cpp        #   BLE + OTA 固件实现
│       └── platformio.ini      #   PlatformIO 工程配置
│
├── libs/
│   ├── libota/                 # 纯 C++ OTA Turbo Native Module（@gtdev/rtn-libota）
│   │   ├── ts/                 #   TypeScript Spec 与导出
│   │   ├── cpp/                #   C++ 实现
│   │   │   ├── common/         #     OTA 引擎、Base64、JSI 适配
│   │   │   ├── _generated/     #     codegen 生成的 JSI Spec（已提交）
│   │   │   └── _codegen_android/ #   Android codegen 包装（react_codegen_RTNLibOTA）
│   │   └── scripts/codegen.ts  #   生成 C++ JSI Spec 的脚本
│   └── eslint-config/          # 共享 ESLint / clang-format 配置
│
├── pnpm-workspace.yaml         # 工作区定义（apps/* 与 libs/*）
└── package.json                # 根包（packageManager: pnpm）
```

---

## 环境要求

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | **24.x**（见 `.nvmrc`） | JS / TS 运行时 |
| pnpm | **10.17.1**（见根 `package.json` 的 `packageManager`） | 包管理器 |
| JDK | **17 或 21** | 构建 Android（推荐使用 Android Studio 内置 JBR） |
| Android SDK / NDK | compileSdk 36、NDK 28.1.x | 通过 Android Studio 安装 |
| PlatformIO（可选） | 最新 | 仅在编译设备端固件时需要 |

---

## 一、安装 Node.js

推荐用版本管理器安装，确保与 `.nvmrc` 中声明的版本一致（24.x）。

使用 [nvm](https://github.com/nvm-sh/nvm)：

```bash
# 在仓库根目录执行，自动读取 .nvmrc
nvm install
nvm use
```

或前往 [Node.js 官网](https://nodejs.org/) 下载 24.x LTS 安装包。

验证安装：

```bash
node -v   # 应输出 v24.x.x
```

---

## 二、安装 pnpm 并安装依赖

本项目固定使用 pnpm，可通过 Corepack 一键启用对应版本（Node 自带 Corepack）：

直接全局安装：`npm install -g pnpm@10.17.1`

在**仓库根目录**安装全部工作区依赖（会一并安装 `apps/*` 与 `libs/*`）：

```bash
pnpm install
```

验证：

```bash
pnpm -v   # 应输出 10.17.1
```

---

## 三、构建 Android（Release APK）

原生 Android 工程已随仓库提交，无需额外执行 `expo prebuild`。直接进入 App 的 android 目录用 Gradle Wrapper 构建：

写入 `local.properties` 文件，内容为：

```
sdk.dir=/Users/<your-username>/Library/Android/sdk
```

在 Windows 上，需要写入 `local.properties` 文件，内容为：

```
sdk.dir=C\:\\Users\\<your-username>\\AppData\\Local\\Android\\Sdk
cmake.dir=C\:\\Users\\<your-username>\\AppData\\Local\\Android\\Sdk\\cmake\\3.31.6
```

然后执行：

```bash
cd apps/OTAExp/android
./gradlew assembleRelease
```

构建成功后，APK 输出位于：

```
apps/OTAExp/android/app/build/outputs/apk/release/
```

将其安装到已开启蓝牙的真机即可（BLE 功能无法在模拟器或 Web 上使用）。

> 提示：若提示找不到 Java，请先设置 `JAVA_HOME` 指向 JDK 17/21，例如使用 Android Studio 内置 JDK：
> ```bash
> export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
> ```

---

## 四、开发调试（可选）

启动 Metro 开发服务器并运行到设备：

```bash
cd apps/OTAExp

# 启动开发服务器
pnpm start

# 或直接编译并运行到 Android 设备 / iOS 设备
pnpm android
pnpm ios
```

---

## 五、设备端固件（可选）

ESP32 固件位于 `apps/hwt605-bt-pio`，使用 PlatformIO 编译与烧录：

```bash
cd apps/hwt605-bt-pio
pnpm build                 # 编译
pnpm upload # 烧录到设备
pnpm monitor # 监听串口
```

---

## 使用流程

1. 真机安装 App 并打开蓝牙；
2. 进入 **Devices** 页扫描并点击设备进行连接；
3. 切换到 **OTA** 页（此时已显示目标设备）；
4. 选择固件文件，点击 **Start OTA** 开始升级。

> 注：OTA 复用 Devices 页建立的连接，不再按固定设备名扫描。
