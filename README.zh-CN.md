<p align="center">
  <img src="build/icon.png" width="112" alt="LavaNotes">
</p>

<h1 align="center">LavaNotes</h1>

<p align="center">
  <b>像真纸一样的桌面便签：错落倾斜的纸张和纸胶带，能放图片和表格，写完的事点 ✓ 撕下。</b>
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

---

## 功能

- **每张便签都是一个独立窗口**：透明异形，纸张带纸纹、阴影和纸胶带；新便签左右交替倾斜、错开摆放，不会叠在同一个位置；点哪张哪张到最前。
- **新便签的窗口层级**在便签管理 → 设置里选：
  - **普通窗口**：可以被其他软件盖住，和平常的窗口一样；
  - **置顶**：始终在最前面；
  - **钉在桌面**：待在桌面图标之上、所有窗口之下，只在桌面露出时看得到；**显示桌面（Win+D）和最小化全部窗口（Win+M）都不会收起它**。
- **右下角折角拖动调整大小**，编辑时也可以；拖顶部纸条、胶带或纸边移动。
- **富文本**：粗体、斜体、下划线、删除线、项目/编号列表、勾选清单。
- **图片**：按钮插入、直接粘贴截图、从资源管理器拖进来；拖图片四角缩放。图片单独存成文件，便签再多也不卡。
- **简单表格**：插入 3×3，增删行列、切换表头、拖列宽。
- **完成并撕下**：点便签右上角的 ✓ 就是完成，便签被撕下收进“已撕下”，可在便签管理里重新贴回。
- **便签管理**：搜索全部便签，查看已撕下的便签（可重新贴回或删除）。
- **托盘常驻、开机启动、自动更新**（GitHub Releases）。

## 下载

到 [Releases](https://github.com/chengcczzjj/LavaNotes/releases/latest) 下载 `LavaNotes-Setup-<版本>.exe`。支持 Windows 10 / 11 x64。安装包没有代码签名，首次运行时 SmartScreen 可能提示，选择“仍要运行”即可。

## 使用

| 操作 | 方法 |
| --- | --- |
| 新建便签 | 托盘双击、托盘菜单、便签左上角 +，或在便签里按 Ctrl+N |
| 移动 | 拖顶部纸条、纸胶带或纸张左右边缘 |
| 调整大小 | 拖右下角折角 |
| 完成并撕下 | 便签右上角的 ✓ |
| 换纸色、打开便签管理、删除 | ⋯ 菜单 |
| 打开链接 | 按住 Ctrl 点击 |
| 显示全部便签 | 单击托盘图标 |

其他程序可以用 `lavanotes://new`（新建）、`lavanotes://manager`（便签管理）、`lavanotes://open`（显示全部）唤起 LavaNotes。

## 数据

全部保存在本机 `%APPDATA%\LavaNotes`：

```
notes-index.json         便签位置、颜色、层级、撕下时间
notes-index.backup.json  上一次成功读取的索引
notes/<id>.json          每张便签的正文
assets/<sha256>.<ext>    图片（同一张图只存一份）
settings.json            设置
```

写入都是“先写临时文件再改名”；索引损坏时会移到旁边并用备份恢复，不会覆盖。

## 开发

需要 Node.js 22。

```bash
npm install
npm run dev           # 开发运行
npm test              # 类型检查 + lint + 单元测试
npm run test:smoke    # 构建后用真实 Electron 窗口跑一遍主要流程（Linux 需 xvfb-run）
npm run dist          # 构建 Windows 安装包（在 Windows 上运行）
```

推送 `v*` 标签，或在 Actions 里手动运行 **Release Windows** 并填写要创建的标签，GitHub Actions 会在 Windows 上测试、构建并发布 Release。设计说明见 [docs/architecture.md](docs/architecture.md)。

## 许可证

[MIT](LICENSE)
