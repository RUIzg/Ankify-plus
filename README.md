# Obsidian Ankify 插件

这是一个 Obsidian 插件，可以使用 DeepSeek API 将当前笔记内容转换为 Anki 卡片。



## 在ankify基础上增加的扩展功能 

- 增加了支持豆包等模型，以及配置自定义url 

- 增加了识图功能  

- 增加了anki卡每个卡单独设置卡片类型的功能  

- 自动识别填空格式：如果回答内容包含 `{{c序号::内容}}` 格式，自动默认选择 Cloze 填空类型

- 智能填空按钮：在 Cloze 类型卡片编辑时，可选中文本点击"填空"按钮自动生成 `{{c序号::选中文本}}` 格式，自动维护序号递增

- 批量替换标签功能：支持统一替换所有卡片的标签，可选择单个替换或全部替换

- 答案文本框优化：将答案输入框改为多行文本框，支持自动换行和 `<br>` 标签与换行符的自动转换

- 卡片标题显示序列号：问题/答案标题显示序号（如"问题1:"、"答案1:"）

- 选择数量实时统计：全选按钮旁显示已选择卡片数量（如"已选择 3/5"），支持动态更新

- Cloze 类型卡片内容合并：问题和答案合并写入到单个字段

- 主题适配：所有界面元素支持夜间模式，自动适配 Obsidian 主题颜色

- 请求信息折叠面板：弹窗底部显示可折叠的请求信息面板，包含图片路径、提示词、选中内容和大模型原始返回信息

- Anki Connect 测试按钮：支持测试 Anki Connect 连接状态

- 添加 "ankify" 固定标签：自动为所有生成的卡片添加 "ankify" 标签

- 批量标签替换界面：可收缩的标签批量替换区域，支持单个标签替换和全部替换

  

## 功能（原ankify）

- 一键将 Obsidian 笔记内容发送到 DeepSeek AI

- 根据自定义提示词生成 Anki 卡片

- 支持个性化提示词设置

- 便捷的复制功能，方便导入到 Anki

  

## 效果展示

<img width="1440" alt="image" src="https://github.com/user-attachments/assets/9335edc7-8815-4a97-b294-c171809a2e91" />
<img width="1440" alt="image" src="https://github.com/user-attachments/assets/0acaf76f-4603-4a08-bddd-8d595b7605ba" />
<img width="1440" alt="image" src="https://github.com/user-attachments/assets/c39aafa4-f3c9-4ad2-b74c-f2889146fe22" />
<img width="640" alt="image" src="https://github.com/user-attachments/assets/b75ebbdd-cb6e-47f7-99f8-38d436d83bea" />

## 安装

### 手动安装

1. 从 GitHub 仓库下载最新版本
2. 解压文件到您的 Obsidian 插件文件夹: `{obsidian_vault}/.obsidian/plugins/`
3. 重新加载 Obsidian
4. 在 Obsidian 设置中启用插件

## 使用方法

1. 在 Obsidian 设置中配置您的 DeepSeek API 密钥
2. 自定义您的提示词（可选）
3. 打开一个笔记
4. 点击侧边栏的 Ankify 按钮或者使用命令面板执行"生成 Anki 卡片"命令
5. 在弹出的结果窗口中查看生成的 Anki 卡片内容
6. 点击"复制内容"按钮将生成的内容复制到剪贴板
7. 将内容导入到 Anki（可使用 Anki 的导入功能）

## 设置

- **DeepSeek API 密钥**: 您需要提供一个有效的 DeepSeek API 密钥才能使用此插件
- **自定义提示词**: 自定义生成 Anki 卡片的提示词模板

## 注意事项

- 此插件需要互联网连接以访问 DeepSeek API
- 生成的卡片质量取决于原始笔记内容和提示词设置
- API 调用可能会产生相关费用，请查看 DeepSeek 的定价策略

## 隐私

- 您的笔记内容将被发送到 DeepSeek API 进行处理
- 本插件不会存储您的内容，但请查看 DeepSeek 的隐私政策了解他们如何处理数据

## 许可证

[MIT](LICENSE)
