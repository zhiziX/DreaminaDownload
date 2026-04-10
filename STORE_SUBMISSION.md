# Chrome / Edge 扩展商店上架流程

## 一、打包

运行打包脚本，或手动将以下文件打成 `.zip`（根目录直接是文件，不要套文件夹）：

```
manifest.json, background.js, content.js, page-bridge.js,
popup.html, popup.js, rules/referer.json,
icons/icon16.png, icons/icon48.png, icons/icon128.png
```

## 二、准备素材

| 素材 | 规格 | 说明 |
|------|------|------|
| 商店图标 | 128x128 PNG | 已有 `icons/icon128.png` |
| 宣传图（小） | 440x280 PNG/JPG | 商店列表展示 |
| 截图 | 1280x800 或 640x400 | 至少 1 张，建议 3-5 张 |

截图建议：即梦图片详情页浮动按钮、扩展弹窗界面、视频详情页双按钮、Dreamina 详情页。

## 三、商店文案

**名称**：即梦Dreamina去水印下载

**简短描述**（132 字符内）：
> 即梦/Dreamina 图片视频去水印下载工具，支持原画解析，一键下载无水印高清资源。

**详细描述**：

```
即梦/Dreamina 去水印下载工具

功能：
• 自动解析即梦和 Dreamina 详情页的图片和视频资源
• 去水印下载高清原图和原画视频
• 即梦主站支持快速下载和原画解析两种模式
• 页面内浮动下载按钮，无需打开扩展弹窗
• 完整适配单页应用路由切换

支持页面：
• 即梦主站（jimeng.jianying.com）图片/视频详情页、生成页
• Dreamina（dreamina.capcut.com）图片/视频详情页、生成页

使用方法：
1. 打开即梦或 Dreamina 的作品详情页
2. 点击页面上的浮动下载按钮，或点击扩展图标
3. 选择下载方式即可保存到本地

本扩展需要读取页面数据以解析媒体资源链接，不会收集任何用户信息。

开源项目：https://github.com/zhiziX/DreaminaDownload
隐私政策：https://github.com/zhiziX/DreaminaDownload/blob/main/PRIVACY_POLICY.md
```

## 四、Chrome 网上应用店

1. 访问 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Google 账号登录，支付一次性 $5 注册费
3. 点击「新建项目」→ 上传 `.zip`
4. 填写名称、描述、分类（工具）、上传截图
5. 隐私权做法：
   - 单一用途：`解析即梦和 Dreamina 平台详情页的图片和视频资源，提供去水印下载功能`
   - 勾选「本扩展不收集或使用用户数据」
   - 隐私政策 URL：`https://github.com/zhiziX/DreaminaDownload/blob/main/PRIVACY_POLICY.md`
6. 提交审核，通常 1-3 个工作日

## 五、Edge 外接程序商店

1. 访问 [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. Microsoft 账号登录，免费注册
3. 点击「创建新扩展」→ 上传同一个 `.zip`
4. 填写信息（同 Chrome），提交审核
5. 通常 1-2 个工作日

## 六、审核注意事项

- **MAIN world 脚本**：`page-bridge.js` 在页面主世界运行以捕获 SPA 路由数据。描述中说明用途即可
- **host_permissions**：`https://*/*` 较宽泛，若被拒可缩小为仅即梦和 Dreamina 域名
- **版本号**：每次重新提交需递增 `manifest.json` 的 `version`

## 七、更新发布

1. 递增 `manifest.json` 中的 `version`
2. 重新打包 `.zip`
3. 在 Developer Dashboard 上传新版本并提交审核
