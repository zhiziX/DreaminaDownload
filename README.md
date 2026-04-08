# 即梦Dreamina去水印下载

一个轻量级的 Chrome 浏览器扩展，用于从即梦（Jimeng）和 Dreamina 平台下载无水印的图片和视频。

## ⚠️ 免责声明

**本工具仅供学习和研究使用，请勿用于商业用途。**

- 本扩展仅解析页面中已公开的资源链接，不涉及任何破解或非法访问行为
- 使用本工具下载的内容版权归原作者所有
- 用户应遵守即梦和 Dreamina 平台的服务条款和版权政策
- 下载的内容仅供个人学习、研究使用，禁止用于商业用途或二次传播
- 因使用本工具产生的任何法律纠纷与开发者无关，使用者需自行承担相关责任

**请尊重原创作者的劳动成果，合理使用本工具。**

---

## ✨ 功能特点

- 🎯 **精准解析**：自动识别即梦/Dreamina详情页的图片和视频资源
- 🚫 **去水印下载**：优先获取无水印的高清原图和视频
- 🎨 **简洁界面**：通过浏览器扩展弹窗一键下载
- ⚡ **快速稳定**：直接解析页面已暴露的资源链接，无需额外请求
- 🔄 **SPA适配**：完美支持单页应用的路由切换和详情页覆盖层

## 📦 安装方法

### 方式一：从源码安装（推荐）

1. 下载本项目代码：
   ```bash
   git clone https://github.com/zhiziX/DreaminaDownload.git
   ```

2. 打开 Chrome 浏览器，访问 `chrome://extensions/`

3. 开启右上角的"开发者模式"

4. 点击"加载已解压的扩展程序"

5. 选择本项目的根目录

6. 安装完成！扩展图标会出现在浏览器工具栏

### 方式二：从 Release 安装

1. 前往 [Releases](https://github.com/zhiziX/DreaminaDownload/releases) 页面
2. 下载最新版本的 `.zip` 文件
3. 解压后按照"方式一"的步骤 2-6 进行安装

## 🚀 使用方法

1. 访问即梦或 Dreamina 的作品详情页：
   - 即梦：`https://jimeng.jianying.com/ai-tool/work-detail/...`
   - Dreamina：`https://dreamina.capcut.com/ai-tool/image/...` 或 `/video/...`

2. 点击浏览器工具栏中的扩展图标

3. 在弹出的窗口中查看解析结果

4. 点击"下载"按钮即可保存到本地

## 🎯 支持的页面

| 平台 | 支持的内容类型 | 页面路径示例 |
|------|---------------|-------------|
| 即梦 | 图片 | `/ai-tool/work-detail/<id>?workDetailType=Image` |
| 即梦 | 视频 | `/ai-tool/work-detail/<id>?workDetailType=AiVideo` |
| Dreamina | 图片 | `/ai-tool/image/<id>` |
| Dreamina | 视频 | `/ai-tool/video/<id>` |

## 🔧 技术原理

本扩展采用多层解析策略，确保稳定获取高质量资源：

### 解析流程

1. **页面识别**：自动判断当前页面类型（图片/视频详情页）
2. **资源定位**：锁定当前详情页的主要媒体元素
3. **多源解析**：
   - Dreamina：官方 API + 页面路由数据 + HTML 内联数据 + DOM
   - 即梦：页面路由数据 + 运行时数据 + HTML 补源 + 主世界桥接 + DOM
4. **质量优选**：按照预设的优先级选择最佳资源链接
5. **下载处理**：自动添加必要的请求头，确保下载成功

### 核心特性

- **SPA 路由监听**：实时监听单页应用的路由变化
- **详情页锁定**：精确识别当前正在查看的作品，避免旧数据干扰
- **多层降级策略**：从高质量原图/原视频逐级降级到 DOM 元素
- **智能去水印**：优先选择无水印或水印较少的资源版本

## 📁 项目结构

```
DreaminaDownload/
├── manifest.json          # 扩展配置文件
├── background.js          # 后台服务脚本（处理下载请求）
├── content.js             # 内容脚本（页面解析逻辑）
├── page-bridge.js         # 页面桥接脚本（主世界数据获取）
├── popup.html             # 弹窗界面
├── popup.js               # 弹窗逻辑
├── rules/                 # 网络请求规则
│   └── referer.json       # Referer 修改规则
├── metadata/              # 扩展元数据
├── README.md              # 项目说明
├── CHANGELOG.md           # 更新日志
├── LICENSE                # 开源协议
└── 解析策略.md             # 详细的技术文档
```

## 🛠️ 开发说明

### 技术栈

- Manifest V3
- Vanilla JavaScript
- Chrome Extension APIs

### 核心模块

- **page-bridge.js**：运行在页面主世界，监听路由变化和数据更新
- **content.js**：运行在扩展隔离世界，负责资源解析和数据提取
- **background.js**：后台服务，处理下载请求和网络规则
- **popup**：用户界面，展示解析结果和提供下载功能

### 调试方法

1. 在 `chrome://extensions/` 页面找到本扩展
2. 点击"详细信息"
3. 开启"收集错误"
4. 点击"背景页"或"检查视图"查看日志

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 提交 Issue

- 请详细描述问题，包括复现步骤
- 附上浏览器版本和扩展版本信息
- 如有可能，提供问题页面的 URL

### 提交 PR

- Fork 本项目
- 创建新的功能分支
- 提交清晰的 commit 信息
- 确保代码风格一致
- 提交 PR 并描述改动内容

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

- 感谢即梦和 Dreamina 平台提供的优质 AI 创作工具
- 感谢所有为本项目做出贡献的开发者

## 📮 联系方式

- 项目主页：[https://github.com/zhiziX/DreaminaDownload](https://github.com/zhiziX/DreaminaDownload)
- 问题反馈：[Issues](https://github.com/zhiziX/DreaminaDownload/issues)

---

**再次提醒：请遵守平台规则，尊重原创作者，合理使用本工具。**
