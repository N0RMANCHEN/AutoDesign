# AutoDesign Smoke Plugin

这个目录只用于验证 Figma Desktop 是否真正加载了当前构建产物。

行为：

- 启动后读取当前页面名和 selection 数量
- 弹出唯一 notify
- 立即关闭插件

推荐使用方式：

- 每次正式插件导入前，先用这个 smoke 插件确认当前 `dist/manifest.json` 能被 Figma 正确加载

常用命令：

```bash
npm run build:plugins
```

导入路径：

- `/Users/hirohi/AutoDesign/plugins/autodesign-smoke/dist/manifest.json`

插件名称：

- `AutoDesign Smoke`
