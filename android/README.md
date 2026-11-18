# Android APK（DeepSeek Unrestricted 2.6.2）

这是纯原生 WebView 壳，不依赖 Capacitor / Cordova：

- `MainActivity` 启动一个只监听 `127.0.0.1:18765` 的本地静态服务器，把 `assets/public` 作为网页根目录；
- WebView 打开 `http://127.0.0.1:18765/index.html`，因此 localStorage、IndexedDB、fetch 都有稳定的 HTTP Origin；
- 已接入文件选择器、麦克风运行时权限、返回键和外部浏览器跳转；
- `assets/backend` 内含 `mcp-server` 与 EasyJailbreak 源码，仅作随包附带；Python / torch 后端不会在 Android 内执行。

## 产物

`android/deepseek-unrestricted-2.6.2.apk`，versionCode 262，使用
`/home/xiaohuangbo/桌面/xiaohuangbo.jks`（别名 `xiaohuangbo`）签名。

SHA-256：`975c9b88b18b648dad7a9fd1ec97653ba34f748178ca945de069d16cb4b3fa2b`（7.2 MB）。

## 构建

需要：

- Android SDK platform 34、build-tools 34.0.0；
- JDK 17（JDK 27 下 d8 8.2 会内部崩溃）；
- 已执行 `pnpm build` 生成 `../dist`。

```sh
export ANDROID_HOME=$HOME/android-sdk
export JAVA_HOME=/path/to/jdk-17
pnpm build
KS_PASS=<keystore-password> KEY_PASS=<key-password> ./android/build-apk.sh
```

签名口令通过环境变量传入，密钥库不进入仓库。脚本会执行 aapt2、javac、d8、zipalign 和 apksigner，并打印签名证书。

## 后端

APK 不会启动 Python 后端。需要实验台时，在电脑上运行：

```sh
cd mcp-server
./run.sh            # http://127.0.0.1:8765/mcp
```

然后在应用「实验台」中把地址改为 `http://<电脑局域网 IP>:8765/mcp`。手机页面 Origin 是
`http://127.0.0.1:18765`，后端默认允许 `http://127.0.0.1:*`。
