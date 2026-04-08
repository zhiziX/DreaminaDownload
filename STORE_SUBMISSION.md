# Chrome & Edge 商店发布指南

本文档包含发布到 Chrome Web Store 和 Edge Add-ons 所需的所有材料和步骤。

---

## 📋 发布前准备清单

### 1. 必需材料

- [x] 扩展源代码（已完成）
- [x] manifest.json（已完成）
- [ ] 图标文件（128x128, 48x48, 16x16）
- [ ] 商店截图（1280x800 或 640x400，至少1张）
- [ ] 宣传图片（可选）
- [ ] 商店描述文案（见下方）
- [ ] 隐私政策（见下方）

### 2. 开发者账号

- **Chrome Web Store**：需要一次性支付 $5 开发者注册费
- **Edge Add-ons**：免费注册

---

## 🎨 图标准备

### 需要的尺寸

创建以下尺寸的图标（PNG 格式，透明背景）：

- **128x128** - 商店展示用
- **48x48** - 扩展管理页面
- **16x16** - 浏览器工具栏

### 图标设计建议

- 使用即梦/Dreamina 相关的视觉元素
- 简洁明了，一眼能看出是下载工具
- 建议配色：蓝色/绿色系（代表下载）

### 保存位置

```
DreaminaDownload/
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
```

然后在 manifest.json 中添加：

```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
},
"action": {
  "default_icon": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png"
  },
  "default_popup": "popup.html",
  "default_title": "即梦Dreamina去水印下载"
}
```

---

## 📸 商店截图准备

### 截图要求

**Chrome Web Store：**
- 尺寸：1280x800 或 640x400
- 格式：PNG 或 JPEG
- 数量：至少 1 张，最多 5 张

**Edge Add-ons：**
- 尺寸：1280x800 或 640x400
- 格式：PNG 或 JPEG
- 数量：至少 1 张，最多 10 张

### 建议截图内容

1. **截图1**：扩展弹窗界面（显示解析结果）
2. **截图2**：即梦详情页 + 扩展图标高亮
3. **截图3**：Dreamina 详情页 + 扩展图标高亮
4. **截图4**：下载成功后的文件列表
5. **截图5**（可选）：功能特点说明图

### 截图技巧

- 使用高分辨率显示器截图
- 确保界面清晰、文字可读
- 可以添加简单的文字说明或箭头标注
- 保持截图风格统一

---

## 📝 商店描述文案

### 简短描述（132 字符以内）

**中文版：**
```
即梦/Dreamina 图片视频去水印下载工具，一键获取高清无水印资源，支持详情页快速解析。
```

**英文版：**
```
Download watermark-free images and videos from Jimeng/Dreamina. One-click access to high-quality resources.
```

### 详细描述

**中文版：**

```
即梦Dreamina去水印下载 - 轻量级媒体下载工具

一个专为即梦（Jimeng）和 Dreamina 平台设计的浏览器扩展，帮助你快速下载无水印的高清图片和视频。

✨ 核心功能

• 精准解析 - 自动识别即梦/Dreamina详情页的图片和视频资源
• 去水印下载 - 优先获取无水印的高清原图和视频
• 简洁界面 - 通过浏览器扩展弹窗一键下载
• 快速稳定 - 直接解析页面已暴露的资源链接，无需额外请求
• SPA适配 - 完美支持单页应用的路由切换和详情页覆盖层

🎯 支持的页面

• 即梦图片详情页
• 即梦视频详情页
• Dreamina 图片详情页
• Dreamina 视频详情页

🚀 使用方法

1. 访问即梦或 Dreamina 的作品详情页
2. 点击浏览器工具栏中的扩展图标
3. 在弹出的窗口中查看解析结果
4. 点击"下载"按钮即可保存到本地

⚠️ 使用说明

• 本工具仅供学习和研究使用，请勿用于商业用途
• 本扩展仅解析页面中已公开的资源链接，不涉及任何破解或非法访问行为
• 使用本工具下载的内容版权归原作者所有
• 请遵守平台服务条款，尊重原创作者的劳动成果

💡 需要更多平台支持？

访问智子X（zhizix.com）获取支持 B站、抖音、小红书、快手等多平台的完整解析工具。

🔗 开源项目

本项目在 GitHub 开源：https://github.com/zhiziX/DreaminaDownload
欢迎提交问题反馈和功能建议。

📄 隐私保护

• 不收集任何用户数据
• 不上传任何下载记录
• 所有操作均在本地完成
```

**英文版：**

```
Dreamina Download - Lightweight Media Downloader

A browser extension designed for Jimeng and Dreamina platforms, helping you quickly download watermark-free high-quality images and videos.

✨ Key Features

• Precise Parsing - Automatically identifies image and video resources on detail pages
• Watermark-Free Download - Prioritizes high-quality original images and videos without watermarks
• Simple Interface - One-click download through browser extension popup
• Fast & Stable - Directly parses exposed page resources without extra requests
• SPA Support - Perfect support for single-page application routing and detail page overlays

🎯 Supported Pages

• Jimeng image detail pages
• Jimeng video detail pages
• Dreamina image detail pages
• Dreamina video detail pages

🚀 How to Use

1. Visit a work detail page on Jimeng or Dreamina
2. Click the extension icon in the browser toolbar
3. View parsing results in the popup window
4. Click the "Download" button to save locally

⚠️ Usage Notice

• This tool is for learning and research purposes only, not for commercial use
• This extension only parses publicly available resource links, no cracking or illegal access involved
• Content downloaded using this tool is copyrighted by the original authors
• Please comply with platform terms of service and respect creators' work

💡 Need More Platform Support?

Visit zhiziX (zhizix.com) for complete parsing tools supporting Bilibili, Douyin, Xiaohongshu, Kuaishou, and more.

🔗 Open Source

This project is open source on GitHub: https://github.com/zhiziX/DreaminaDownload
Welcome to submit feedback and feature suggestions.

📄 Privacy Protection

• No user data collection
• No download history uploaded
• All operations completed locally
```

---

## 🔒 隐私政策

创建文件：`PRIVACY_POLICY.md`

```markdown
# 隐私政策

最后更新日期：2026年4月8日

## 数据收集

即梦Dreamina去水印下载扩展（以下简称"本扩展"）不会收集、存储或传输任何用户个人信息或使用数据。

## 权限说明

本扩展请求以下权限，仅用于实现核心功能：

### activeTab
- 用途：读取当前标签页的 URL 和页面内容
- 说明：仅在用户主动点击扩展图标时访问，用于解析媒体资源

### downloads
- 用途：触发浏览器下载功能
- 说明：将解析到的图片/视频保存到用户的下载文件夹

### storage
- 用途：存储扩展设置
- 说明：所有数据仅保存在用户本地浏览器中，不会上传到任何服务器

### declarativeNetRequestWithHostAccess
- 用途：修改特定请求的 Referer 头
- 说明：确保下载请求能够成功，不会拦截或修改其他网络请求

### host_permissions
- 用途：访问即梦和 Dreamina 平台的页面
- 说明：仅在这些平台的详情页上运行，用于解析媒体资源

## 数据存储

本扩展使用浏览器的本地存储（chrome.storage.local）保存用户设置，所有数据仅存储在用户设备上，不会同步到云端或传输到任何服务器。

## 第三方服务

本扩展不使用任何第三方分析服务、广告服务或数据收集服务。

## 网络请求

本扩展仅在以下情况下发起网络请求：

1. 用户主动点击下载按钮时，向即梦/Dreamina 平台请求媒体资源
2. 所有请求均直接发送到原平台，不经过任何中间服务器

## 用户权利

用户可以随时：

- 卸载本扩展
- 清除浏览器本地存储数据
- 在浏览器扩展管理页面中撤销权限

## 政策更新

如果本隐私政策有任何更新，我们会在 GitHub 项目页面发布通知。

## 联系方式

如有任何隐私相关问题，请通过以下方式联系：

- GitHub Issues: https://github.com/zhiziX/DreaminaDownload/issues
- 项目主页: https://github.com/zhiziX/DreaminaDownload
```

---

## 📦 打包扩展

### 1. 清理项目

删除不需要的文件：

```bash
cd E:\AI\zhiziX_github\DreaminaDownload
rm -rf .git .gitignore STORE_SUBMISSION.md
```

### 2. 创建 ZIP 包

**方法一：使用命令行**

```bash
# Windows PowerShell
Compress-Archive -Path * -DestinationPath dreamina-download-v1.0.0.zip

# 或使用 7-Zip
7z a -tzip dreamina-download-v1.0.0.zip *
```

**方法二：手动压缩**

1. 选中所有文件（不要包含外层文件夹）
2. 右键 → 发送到 → 压缩(zipped)文件夹
3. 重命名为 `dreamina-download-v1.0.0.zip`

⚠️ **重要**：ZIP 包内应该直接是 `manifest.json` 等文件，而不是一个文件夹

---

## 🚀 Chrome Web Store 发布流程

### 1. 注册开发者账号

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 使用 Google 账号登录
3. 支付 $5 一次性注册费
4. 填写开发者信息

### 2. 上传扩展

1. 点击"新增项"
2. 上传 ZIP 包
3. 填写商店信息：

**商品详情：**
- 扩展名称：即梦Dreamina去水印下载
- 简短说明：（使用上面准备的简短描述）
- 详细说明：（使用上面准备的详细描述）
- 类别：生产工具
- 语言：中文（简体）

**图形资源：**
- 图标：上传 128x128 图标
- 截图：上传 1-5 张截图
- 宣传图片（可选）

**隐私权：**
- 单一用途：媒体资源下载工具
- 权限理由：（说明每个权限的用途）
- 隐私政策：粘贴隐私政策内容或提供链接

**分发：**
- 可见性：公开
- 地区：所有地区

### 3. 提交审核

1. 检查所有信息
2. 点击"提交审核"
3. 等待审核（通常 1-3 个工作日）

### 4. 审核通过后

- 扩展会自动发布到商店
- 记录扩展 ID（用于后续更新）
- 在 README 中添加商店链接

---

## 🌐 Edge Add-ons 发布流程

### 1. 注册开发者账号

1. 访问 [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. 使用 Microsoft 账号登录（免费）
3. 完成开发者注册

### 2. 上传扩展

1. 点击"创建新扩展"
2. 上传 ZIP 包（与 Chrome 相同的包）
3. 填写商店信息：

**产品详情：**
- 显示名称：即梦Dreamina去水印下载
- 简短描述：（使用上面准备的简短描述）
- 详细描述：（使用上面准备的详细描述）
- 类别：生产力
- 语言：中文（简体）

**商店列表资源：**
- 图标：上传 128x128 图标
- 截图：上传 1-10 张截图

**隐私：**
- 隐私政策 URL：提供隐私政策链接
- 权限说明：说明每个权限的用途

**可用性：**
- 市场：所有市场
- 可见性：公开

### 3. 提交认证

1. 检查所有信息
2. 点击"提交认证"
3. 等待审核（通常 1-5 个工作日）

### 4. 认证通过后

- 扩展会自动发布到商店
- 记录扩展 ID
- 在 README 中添加商店链接

---

## 🔄 后续更新流程

### 更新版本号

在 `manifest.json` 中修改版本号：

```json
"version": "1.0.1"
```

### 准备更新说明

在 `CHANGELOG.md` 中添加更新内容。

### 重新打包上传

1. 创建新的 ZIP 包
2. 在开发者控制台上传新版本
3. 填写更新说明
4. 提交审核

---

## ✅ 发布检查清单

发布前请确认：

- [ ] manifest.json 中的版本号正确
- [ ] 所有图标文件已准备
- [ ] 截图清晰且符合要求
- [ ] 商店描述文案已准备
- [ ] 隐私政策已准备
- [ ] ZIP 包结构正确（根目录是文件，不是文件夹）
- [ ] 在本地测试扩展功能正常
- [ ] 删除了 .git 等开发文件
- [ ] README 中的链接正确

---

## 📞 常见问题

### Q: 审核被拒怎么办？

A: 查看拒绝原因，通常是：
- 权限说明不清楚
- 隐私政策缺失或不完整
- 功能描述不准确
- 截图不符合要求

根据反馈修改后重新提交。

### Q: 可以同时发布到两个商店吗？

A: 可以，使用相同的 ZIP 包即可。

### Q: 更新需要重新审核吗？

A: 是的，每次更新都需要审核，但通常比首次审核快。

### Q: 如何获得更多下载量？

A: 
- 在 GitHub README 中添加商店链接
- 在智子X主站推广
- 在相关社区分享
- 保持更新，及时修复问题

---

## 📚 参考资源

- [Chrome Web Store 开发者文档](https://developer.chrome.com/docs/webstore/)
- [Edge Add-ons 开发者文档](https://docs.microsoft.com/microsoft-edge/extensions-chromium/publish/publish-extension)
- [Chrome 扩展最佳实践](https://developer.chrome.com/docs/extensions/mv3/intro/)
