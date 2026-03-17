import { App, PluginSettingTab, Setting } from "obsidian";
import { AnkifyPlugin } from "./AnkifyPlugin";

// 设置面板
export class AnkifySettingTab extends PluginSettingTab {
  plugin: AnkifyPlugin;

  constructor(app: App, plugin: AnkifyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Ankify 插件设置" });

    // API模型选择
    new Setting(containerEl)
      .setName("API模型")
      .setDesc("选择使用的AI模型")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek", "DeepSeek")
          .addOption("openai", "OpenAI")
          .addOption("claude", "Claude")
          .addOption("doubao", "豆包")
          .addOption("custom", "自定义API")
          .setValue(this.plugin.settings.apiModel)
          .onChange(async (value) => {
            this.plugin.settings.apiModel = value;
            await this.plugin.saveSettings();
          })
      );

    // DeepSeek API设置
    containerEl.createEl("h3", { text: "DeepSeek API设置" });
    new Setting(containerEl)
      .setName("DeepSeek API密钥")
      .setDesc("获取API密钥: https://platform.deepseek.com/")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async (value) => {
            this.plugin.settings.deepseekApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek API URL")
      .setDesc("DeepSeek API的URL地址")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com/v1/chat/completions")
          .setValue(this.plugin.settings.deepseekApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.deepseekApiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // OpenAI API设置
    containerEl.createEl("h3", { text: "OpenAI API设置" });
    new Setting(containerEl)
      .setName("OpenAI API密钥")
      .setDesc("获取API密钥: https://platform.openai.com/")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // Claude API设置
    containerEl.createEl("h3", { text: "Claude API设置" });
    new Setting(containerEl)
      .setName("Claude API密钥")
      .setDesc("获取API密钥: https://console.anthropic.com/")
      .addText((text) =>
        text
          .setPlaceholder("sk-ant-api03-...")
          .setValue(this.plugin.settings.claudeApiKey)
          .onChange(async (value) => {
            this.plugin.settings.claudeApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // 豆包 API 设置
    containerEl.createEl("h3", { text: "豆包 API 设置" });
    new Setting(containerEl)
      .setName("豆包 API 密钥")
      .setDesc("获取 API 密钥: https://console.volces.com/")
      .addText((text) =>
        text
          .setPlaceholder("ak-...")
          .setValue(this.plugin.settings.doubaoApiKey)
          .onChange(async (value) => {
            this.plugin.settings.doubaoApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("豆包 API URL")
      .setDesc("豆包 API 的 URL 地址")
      .addText((text) =>
        text
          .setPlaceholder("https://ark.cn-beijing.volces.com/api/v3/chat/completions")
          .setValue(this.plugin.settings.doubaoApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.doubaoApiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("豆包模型名称")
      .setDesc("豆包模型的名称")
      .addText((text) =>
        text
          .setPlaceholder("doubao-1-5-vision-pro-32k-250115")
          .setValue(this.plugin.settings.doubaoModelName)
          .onChange(async (value) => {
            this.plugin.settings.doubaoModelName = value;
            await this.plugin.saveSettings();
          })
      );

    // 自定义API设置
    containerEl.createEl("h3", { text: "自定义API设置" });
    new Setting(containerEl)
      .setName("自定义API URL")
      .setDesc("自定义API的URL地址")
      .addText((text) =>
        text
          .setPlaceholder("https://api.example.com/v1/chat/completions")
          .setValue(this.plugin.settings.customApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.customApiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自定义API密钥")
      .setDesc("自定义API的密钥")
      .addText((text) =>
        text
          .setPlaceholder("api-key")
          .setValue(this.plugin.settings.customApiKey)
          .onChange(async (value) => {
            this.plugin.settings.customApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自定义模型名称")
      .setDesc("自定义模型的名称")
      .addText((text) =>
        text
          .setPlaceholder("custom-model")
          .setValue(this.plugin.settings.customModelName)
          .onChange(async (value) => {
            this.plugin.settings.customModelName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自定义API版本")
      .setDesc("自定义API的版本")
      .addText((text) =>
        text
          .setPlaceholder("2024-05-01")
          .setValue(this.plugin.settings.customApiVersion)
          .onChange(async (value) => {
            this.plugin.settings.customApiVersion = value;
            await this.plugin.saveSettings();
          })
      );

    // 通用设置
    containerEl.createEl("h3", { text: "通用设置" });
    new Setting(containerEl)
      .setName("自定义提示词")
      .setDesc("用于生成Anki卡片的提示词")
      .addTextArea((textarea) =>
        textarea
          .setPlaceholder("请基于以下内容创建Anki卡片...")
          .setValue(this.plugin.settings.customPrompt)
          .onChange(async (value) => {
            this.plugin.settings.customPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("视觉提示词")
      .setDesc("用于图片识别的提示词")
      .addTextArea((textarea) =>
        textarea
          .setPlaceholder("请识别这张图片中的内容...")
          .setValue(this.plugin.settings.visionPrompt)
          .onChange(async (value) => {
            this.plugin.settings.visionPrompt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("图片最大尺寸")
      .setDesc("图片的最大尺寸（像素）")
      .addSlider((slider) =>
        slider
          .setLimits(256, 2048, 256)
          .setValue(this.plugin.settings.maxImageSize)
          .onChange(async (value) => {
            this.plugin.settings.maxImageSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("图片质量")
      .setDesc("图片的压缩质量（0-1）")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.1)
          .setValue(this.plugin.settings.imageQuality)
          .onChange(async (value) => {
            this.plugin.settings.imageQuality = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("直接插入文档")
      .setDesc("生成卡片后直接插入到文档中，而不是显示编辑弹窗")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.insertToDocument)
          .onChange(async (value) => {
            this.plugin.settings.insertToDocument = value;
            await this.plugin.saveSettings();
          })
      );

    // Anki Connect设置
    containerEl.createEl("h3", { text: "Anki Connect设置" });
    new Setting(containerEl)
      .setName("Anki Connect URL")
      .setDesc("Anki Connect的API地址")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8765")
          .setValue(this.plugin.settings.ankiConnectUrl)
          .onChange(async (value) => {
            this.plugin.settings.ankiConnectUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认牌组")
      .setDesc("默认的Anki牌组")
      .addText((text) =>
        text
          .setPlaceholder("Default")
          .setValue(this.plugin.settings.defaultDeck)
          .onChange(async (value) => {
            this.plugin.settings.defaultDeck = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认笔记类型")
      .setDesc("默认的Anki笔记类型")
      .addText((text) =>
        text
          .setPlaceholder("Basic")
          .setValue(this.plugin.settings.defaultNoteType)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteType = value;
            await this.plugin.saveSettings();
          })
      );

    // 返回结果解析设置
    containerEl.createEl("h3", { text: "返回结果解析设置" });
    new Setting(containerEl)
      .setName("问题标记符")
      .setDesc("用于识别问题的标记符，如 %question%")
      .addText((text) =>
        text
          .setPlaceholder("%question%")
          .setValue(this.plugin.settings.questionMarker)
          .onChange(async (value) => {
            this.plugin.settings.questionMarker = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("回答标记符")
      .setDesc("用于识别回答的标记符，如 %answer%")
      .addText((text) =>
        text
          .setPlaceholder("%answer%")
          .setValue(this.plugin.settings.answerMarker)
          .onChange(async (value) => {
            this.plugin.settings.answerMarker = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("标签标记符")
      .setDesc("用于识别标签的标记符，如 %tags%")
      .addText((text) =>
        text
          .setPlaceholder("%tags%")
          .setValue(this.plugin.settings.tagsMarker)
          .onChange(async (value) => {
            this.plugin.settings.tagsMarker = value;
            await this.plugin.saveSettings();
          })
      );

    // 连接测试按钮
    new Setting(containerEl)
      .setName("连接测试")
      .setDesc("测试与Anki Connect的连接")
      .addButton((button) =>
        button
          .setButtonText("测试连接")
          .onClick(async () => {
            try {
              const result = await this.plugin.invokeAnkiConnect("version");
              new Notice(`Anki Connect版本: ${result}`);
            } catch (error) {
              new Notice(`Anki Connect连接失败: ${error.message}`);
            }
          })
      );
  }
}
