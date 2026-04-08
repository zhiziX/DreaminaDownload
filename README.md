# 即梦Dreamina去水印下载

一个轻量级的 Chrome 浏览器扩展，用于从即梦（Jimeng）和 Dreamina 平台下载无水印的图片和视频。

> 💡 **需要更多平台支持？** 访问 [智子X](https://zhizix.com) 获取支持 B站、抖音、小红书、快手等多平台的完整解析工具。

---

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
