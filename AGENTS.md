# LavaNotes 开发指引

适用于在本仓库工作的开发智能体与贡献者。

- 设计取舍见 [docs/architecture.md](docs/architecture.md)；改窗口、穿透、缩放、钉在桌面前先读。
- 依赖版本以 `package.json` / `package-lock.json` 为准。React、TipTap 等渲染端库放 devDependencies（打包进渲染产物），主进程运行时依赖才放 dependencies。
- 验证：代码改动跑 `npm test`；窗口、preload、协议、构建配置改动再跑 `npm run test:smoke`（Linux 用 `xvfb-run -a npm run test:smoke`）。钉在桌面、Win+D/Win+M、透明合成需要 Windows 实机验证，未验证就如实说明。
- `src/shared` 与 `src/main/{storage,assets,notes-service}.ts` 不依赖 Electron，用带 `.ts` 后缀的相对路径互相引用，测试直接用 `node --experimental-strip-types` 加载。不要在其中用构造函数参数属性等 strip-types 不支持的语法。
- 便签窗口默认各自一个渲染进程（共享进程方式在 Windows 上出现过白底，仅作 `LAVANOTES_SHARED_PROCESS=1` 选项保留）：preload 按页面路径分配 API；主进程 IPC 一律按 `event.sender` 反查便签或确认管理窗口，不信任渲染进程传入的便签 ID。
- 边距穿透由主进程轮询光标并向页面询问命中，不依赖 Electron 的鼠标转发；改透明窗口或穿透逻辑后必须让 CI 的 Windows 冒烟测试通过。
- 用户数据只写 `app.getPath('userData')`；不要把便签正文写进日志。
- 发布：更新 `package.json` 版本和 `docs/releases/v<版本>.md`，推送 `v<版本>` 标签或在 Actions 手动运行 Release Windows；已发布的版本不覆盖。
- commit message 用 `<type>(<scope>): <summary>`。
