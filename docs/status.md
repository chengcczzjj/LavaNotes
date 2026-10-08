# 当前状态

> 更新：2026-10-08。开发从云端会话转回本地（Windows）。本地开始工作前先读这里和 [architecture.md](architecture.md)。

## 版本

- **1.0.0**：已发布。Windows 实机上便签窗口出现不透明白底、整张便签无法点击（点击全部穿透到后面）。
- **1.0.1**：修复上述两个问题，已于 2026-10-08 发布（tag `v1.0.1` → `27e7002`），安装包、blockmap、latest.yml 已核对一致；**尚未在 Windows 实机验收**。
  - 穿透改为主进程轮询光标并向页面询问命中，不再依赖 Electron 的鼠标转发。
  - 便签窗口改为各自单独创建；页面加载后与显示前再次设置透明背景；首次显示先以透明度 0 置顶再回到自己的层级。
  - CI 的 Windows 冒烟测试已通过：红色窗口垫在便签后截屏，边距透出红色、纸面正常；真实鼠标点击边距落到后面的窗口，点击纸面落到便签。

## 下一步

1. 在 Windows 实机安装 1.0.1 并验收：纸面可点击、输入、拖动、右下角缩放；透明边距点击落到桌面；钉在桌面后 Win+D / Win+M 不收起；多张便签与混合 DPI 多屏。
2. 观察每张便签单独一个进程后的内存占用，必要时再评估共享进程方式（`LAVANOTES_SHARED_PROCESS=1`，Windows 上曾出现白底）。

## 本地开发

```powershell
npm.cmd install
npm.cmd test              # 类型检查、lint、单元测试
npm.cmd run dev           # 开发模式启动
npm.cmd run test:smoke    # 构建后跑冒烟测试（Windows 上含截屏与真实点击检查，运行时会移动鼠标）
npm.cmd run dist          # 本地打安装包到 dist/
```

## 相关仓库

- [LavaDesk](https://github.com/chengcczzjj/LavaDesk)（原灵月桌面）：通过 `lavanotes://` 检测和唤起本软件；1.2.0 已发布。
