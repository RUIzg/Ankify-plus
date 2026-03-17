import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { AnkifyPlugin } from "../main";

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

    // ========== 基础配置 ==========
    containerEl.createEl("h3", { text: "基础配置" });

    // API模型选择
    new Setting(containerEl)
      .setName("AI模型选择")
      .setDesc("选择用于生成Anki卡片的AI模型")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("deepseek", "DeepSeek")
          .addOption("openai", "OpenAI")
          .addOption("claude", "Claude")
          .addOption("doubao", "豆包 (Doubao)")
          .addOption("custom", "自定义API")
          .setValue(this.plugin.settings.apiModel)
          .onChange(async (value) => {
            this.plugin.settings.apiModel = value;
            await this.plugin.saveSettings();
            // 刷新设置页面以显示相应的API密钥设置
            this.display();
          });
      });

    // 根据选择的模型显示相应的API密钥设置
    if (this.plugin.settings.apiModel === "deepseek") {
      new Setting(containerEl)
        .setName("DeepSeek API 密钥")
        .setDesc("输入您的DeepSeek API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.deepseekApiKey)
            .onChange(async (value) => {
              this.plugin.settings.deepseekApiKey = value;
              await this.plugin.saveSettings();
            })
        );

      // DeepSeek API URL 选择
      const deepseekUrlSetting = new Setting(containerEl)
        .setName("DeepSeek API URL")
        .setDesc("选择或输入DeepSeek API的URL地址");

      const deepseekUrlContainer = deepseekUrlSetting.settingEl.createDiv();
      deepseekUrlContainer.style.display = "flex";
      deepseekUrlContainer.style.flexDirection = "column";
      deepseekUrlContainer.style.gap = "10px";
      deepseekUrlContainer.style.marginTop = "10px";

      // 下拉选择常用URL
      const urlSelect = deepseekUrlContainer.createEl("select");
      urlSelect.style.width = "100%";
      urlSelect.style.padding = "5px";
      urlSelect.style.marginBottom = "5px";

      const urlOptions = [
        { value: "https://api.deepseek.com/v1/chat/completions", label: "DeepSeek 官方 API (v1)", url: "https://api.deepseek.com/v1/chat/completions" },
        { value: "https://api.deepseek.com/v3/chat", label: "DeepSeek V3 API", url: "https://api.deepseek.com/v3/chat" },
        { value: "custom", label: "自定义 URL", url: "" }
      ];

      urlOptions.forEach(option => {
        const opt = urlSelect.createEl("option");
        opt.value = option.value;
        opt.text = `${option.label} - ${option.url || "手动输入"}`;
        if (this.plugin.settings.deepseekApiUrl === option.value) {
          opt.selected = true;
        }
      });

      // 自定义URL输入框
      const customUrlInput = deepseekUrlContainer.createEl("input");
      customUrlInput.type = "text";
      customUrlInput.placeholder = "输入自定义API URL";
      customUrlInput.style.width = "100%";
      customUrlInput.style.padding = "5px";
      customUrlInput.style.display = this.plugin.settings.deepseekApiUrl === "custom" || 
        !urlOptions.some(opt => opt.value === this.plugin.settings.deepseekApiUrl) ? "block" : "none";
      
      if (!urlOptions.some(opt => opt.value === this.plugin.settings.deepseekApiUrl)) {
        customUrlInput.value = this.plugin.settings.deepseekApiUrl;
      }

      // 下拉选择事件
      urlSelect.addEventListener("change", async () => {
        const selectedValue = urlSelect.value;
        if (selectedValue === "custom") {
          customUrlInput.style.display = "block";
          this.plugin.settings.deepseekApiUrl = customUrlInput.value || "";
        } else {
          customUrlInput.style.display = "none";
          this.plugin.settings.deepseekApiUrl = selectedValue;
        }
        await this.plugin.saveSettings();
      });

      // 自定义URL输入事件
      customUrlInput.addEventListener("input", async () => {
        if (urlSelect.value === "custom") {
          this.plugin.settings.deepseekApiUrl = customUrlInput.value;
          await this.plugin.saveSettings();
        }
      });

    } else if (this.plugin.settings.apiModel === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API 密钥")
        .setDesc("输入您的OpenAI API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.apiModel === "claude") {
      new Setting(containerEl)
        .setName("Claude API 密钥")
        .setDesc("输入您的Claude API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.claudeApiKey)
            .onChange(async (value) => {
              this.plugin.settings.claudeApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.apiModel === "custom") {
      new Setting(containerEl)
        .setName("自定义API URL")
        .setDesc("输入自定义API的完整URL")
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
        .setName("自定义API 密钥")
        .setDesc("输入自定义API的密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.customApiKey)
            .onChange(async (value) => {
              this.plugin.settings.customApiKey = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("自定义模型名称")
        .setDesc("输入要使用的模型名称")
        .addText((text) =>
          text
            .setPlaceholder("model-name")
            .setValue(this.plugin.settings.customModelName)
            .onChange(async (value) => {
              this.plugin.settings.customModelName = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("自定义API 版本 (可选)")
        .setDesc("如果需要指定API版本，请在此输入")
        .addText((text) =>
          text
            .setPlaceholder("例如：2023-06-01")
            .setValue(this.plugin.settings.customApiVersion)
            .onChange(async (value) => {
              this.plugin.settings.customApiVersion = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.apiModel === "doubao") {
      new Setting(containerEl)
        .setName("豆包 API 密钥")
        .setDesc("输入您的豆包 API 密钥")
        .addText((text) =>
          text
            .setPlaceholder("输入豆包 API 密钥")
            .setValue(this.plugin.settings.doubaoApiKey)
            .onChange(async (value) => {
              this.plugin.settings.doubaoApiKey = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("豆包 API URL")
        .setDesc("输入豆包 API 的 URL 地址")
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
        .setDesc("输入要使用的豆包模型名称")
        .addText((text) =>
          text
            .setPlaceholder("doubao-1-5-vision-pro-32k-250115")
            .setValue(this.plugin.settings.doubaoModelName)
            .onChange(async (value) => {
              this.plugin.settings.doubaoModelName = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // 自定义Prompt
    new Setting(containerEl)
      .setName("文本内容Prompt")
      .setDesc("设置生成Anki卡片的提示词（用于文本内容）")
      .addTextArea(
        (text) =>
          (text
            .setPlaceholder(
              '请基于以下内容创建Anki卡片，格式为"%question%:问题 %answer%:答案 %tags%:#标签"...'
            )
            .setValue(this.plugin.settings.customPrompt)
            .onChange(async (value) => {
              this.plugin.settings.customPrompt = value;
              await this.plugin.saveSettings();
            }).inputEl.style.minHeight = "80px")
      );

    // 图片识别Prompt
    new Setting(containerEl)
      .setName("图片识别Prompt")
      .setDesc("设置识别图片内容并生成Anki卡片的提示词")
      .addTextArea(
        (text) =>
          (text
            .setPlaceholder(
              '请识别这张图片中的内容，并基于图片内容创建Anki卡片...'
            )
            .setValue(this.plugin.settings.visionPrompt)
            .onChange(async (value) => {
              this.plugin.settings.visionPrompt = value;
              await this.plugin.saveSettings();
            }).inputEl.style.minHeight = "80px")
      );

    // API连通性测试
    const apiTestSetting = new Setting(containerEl)
      .setName("API连通性测试")
      .setDesc("测试当前选择的API是否可以正常连接");

    const apiTestContainer = apiTestSetting.settingEl.createDiv();
    apiTestContainer.style.display = "flex";
    apiTestContainer.style.alignItems = "center";
    apiTestContainer.style.gap = "10px";
    apiTestContainer.style.marginTop = "10px";

    const apiTestButton = apiTestContainer.createEl("button", {
      text: "测试API连接",
    });

    const apiTestStatus = apiTestContainer.createEl("span");
    apiTestStatus.style.fontSize = "20px";

    const apiTestResult = containerEl.createEl("div");
    apiTestResult.style.marginTop = "10px";
    apiTestResult.style.padding = "10px";
    apiTestResult.style.backgroundColor = "#f5f5f5";
    apiTestResult.style.border = "1px solid #ddd";
    apiTestResult.style.borderRadius = "4px";
    apiTestResult.style.fontFamily = "monospace";
    apiTestResult.style.fontSize = "12px";
    apiTestResult.style.display = "none";

    apiTestButton.addEventListener("click", async () => {
      apiTestButton.disabled = true;
      apiTestButton.textContent = "测试中...";
      apiTestStatus.textContent = "";
      apiTestResult.textContent = "";
      apiTestResult.style.display = "none";

      try {
        const testResult = await this.plugin.callModelAPI("测试连接");
        apiTestStatus.textContent = "✅";
        apiTestStatus.style.color = "green";
        apiTestResult.textContent = `连接成功！\n\nAPI返回示例:\n${testResult.substring(0, 200)}...`;
        apiTestResult.style.display = "block";
        new Notice("API连接测试成功");
      } catch (error) {
        apiTestStatus.textContent = "❌";
        apiTestStatus.style.color = "red";
        apiTestResult.textContent = `连接失败：\n${error.message}`;
        apiTestResult.style.display = "block";
        new Notice("API连接测试失败");
      } finally {
        apiTestButton.disabled = false;
        apiTestButton.textContent = "测试API连接";
      }
    });

    // 图片识别测试
    const visionTestSetting = new Setting(containerEl)
      .setName("图片识别测试")
      .setDesc("选择图片文件进行测试");

    const visionTestContainer = visionTestSetting.settingEl.createDiv();
    visionTestContainer.style.marginTop = "10px";

    // 文件选择器
    const visionTestFileInput = visionTestContainer.createEl("input", {
      type: "file",
      attr: {
        accept: "image/*"
      }
    });
    visionTestFileInput.style.marginBottom = "10px";

    const visionTestButtonContainer = visionTestContainer.createDiv();
    visionTestButtonContainer.style.display = "flex";
    visionTestButtonContainer.style.alignItems = "center";
    visionTestButtonContainer.style.gap = "10px";
    visionTestButtonContainer.style.marginTop = "10px";

    const visionTestButton = visionTestButtonContainer.createEl("button", {
      text: "测试图片识别",
    });

    const visionTestStatus = visionTestButtonContainer.createEl("span");
    visionTestStatus.style.fontSize = "20px";

    const visionTestResult = containerEl.createEl("textarea");
    visionTestResult.placeholder = "识别结果将显示在这里...";
    visionTestResult.style.width = "100%";
    visionTestResult.style.minHeight = "150px";
    visionTestResult.style.marginTop = "10px";
    visionTestResult.style.padding = "10px";
    visionTestResult.style.backgroundColor = "#f5f5f5";
    visionTestResult.style.border = "1px solid #ddd";
    visionTestResult.style.borderRadius = "4px";
    visionTestResult.style.fontFamily = "monospace";
    visionTestResult.style.fontSize = "12px";
    visionTestResult.style.display = "none";
    visionTestResult.readOnly = true;

    visionTestButton.addEventListener("click", async () => {
      const file = visionTestFileInput.files?.[0];
      if (!file) {
        new Notice("请先选择图片文件");
        return;
      }

      visionTestButton.disabled = true;
      visionTestButton.textContent = "识别中...";
      visionTestStatus.textContent = "";
      visionTestResult.textContent = "";
      visionTestResult.style.display = "none";

      try {
        console.log('开始读取图片:', file.name, '大小:', file.size);
        console.log('使用的Prompt:', this.plugin.settings.visionPrompt);

        // 使用FileReader读取文件
        const reader = new FileReader();
        const base64Image = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        console.log('Base64转换成功，大小:', Math.round(base64Image.length / 1024), 'KB');

        // 压缩图片
        const compressedImage = await this.plugin.compressImage(base64Image);
        console.log('图片压缩完成');

        // 调用图片识别API
        const result = await this.plugin.callVisionAPI(compressedImage);

        visionTestStatus.textContent = "✅";
        visionTestStatus.style.color = "green";

        // 显示使用的Prompt和识别结果
        const resultText = `【使用的Prompt】\n${this.plugin.settings.visionPrompt}\n\n${'='.repeat(50)}\n\n【识别结果】\n${result}`;
        visionTestResult.textContent = resultText;
        visionTestResult.style.display = "block";
        new Notice("图片识别测试成功");
      } catch (error) {
        console.error('图片识别测试失败:', error);
        visionTestStatus.textContent = "❌";
        visionTestStatus.style.color = "red";
        visionTestResult.textContent = `识别失败：\n${error.message}`;
        visionTestResult.style.display = "block";
        new Notice("图片识别测试失败");
      } finally {
        visionTestButton.disabled = false;
        visionTestButton.textContent = "测试图片识别";
      }
    });

    // ========== Debug模式 ==========
    // ========== 图片识别设置 ==========
    containerEl.createEl("h3", { text: "图片识别设置" });

    new Setting(containerEl)
      .setName("图片最大尺寸")
      .setDesc("图片识别前会压缩到此尺寸（像素），减少token消耗。推荐：512-1024")
      .addText((text) =>
        text
          .setPlaceholder("1024")
          .setValue(String(this.plugin.settings.maxImageSize))
          .onChange(async (value) => {
            const size = parseInt(value);
            if (!isNaN(size) && size > 0) {
              this.plugin.settings.maxImageSize = size;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("图片压缩质量")
      .setDesc("图片压缩质量（0.1-1.0），越低文件越小但质量越差。推荐：0.7-0.9")
      .addText((text) =>
        text
          .setPlaceholder("0.8")
          .setValue(String(this.plugin.settings.imageQuality))
          .onChange(async (value) => {
            const quality = parseFloat(value);
            if (!isNaN(quality) && quality >= 0.1 && quality <= 1.0) {
              this.plugin.settings.imageQuality = quality;
              await this.plugin.saveSettings();
            }
          })
      );

    // Anki Connect 相关设置
    containerEl.createEl("h3", { text: "Anki Connect 设置" });

    // Anki Connect URL 设置和测试
    const ankiConnectSetting = new Setting(containerEl)
      .setName("Anki Connect URL")
      .setDesc("Anki Connect API的地址，默认为 http://127.0.0.1:8765");

    const ankiConnectContainer = ankiConnectSetting.settingEl.createDiv();
    ankiConnectContainer.style.display = "flex";
    ankiConnectContainer.style.alignItems = "center";
    ankiConnectContainer.style.gap = "10px";
    ankiConnectContainer.style.marginTop = "10px";

    // URL 输入框
    const urlInput = ankiConnectContainer.createEl("input");
    urlInput.type = "text";
    urlInput.placeholder = "http://127.0.0.1:8765";
    urlInput.value = this.plugin.settings.ankiConnectUrl;
    urlInput.style.flex = "1";
    urlInput.style.padding = "5px";
    urlInput.addEventListener("change", async () => {
      this.plugin.settings.ankiConnectUrl = urlInput.value;
      await this.plugin.saveSettings();
    });

    // 测试按钮
    const testButton = ankiConnectContainer.createEl("button");
    testButton.textContent = "测试连接";
    testButton.addEventListener("click", async () => {
      testButton.disabled = true;
      testButton.textContent = "测试中...";
      
      try {
        const result = await this.plugin.invokeAnkiConnect("version");
        new Notice(`Anki Connect 连接成功！版本: ${result}`);
      } catch (error) {
        console.error("Anki Connect 测试失败:", error);
        new Notice(`Anki Connect 连接失败: ${error.message}`);
      } finally {
        testButton.disabled = false;
        testButton.textContent = "测试连接";
      }
    });

    new Setting(containerEl)
      .setName("默认牌组")
      .setDesc("添加卡片时的默认牌组名称")
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
      .setDesc("添加卡片时的默认笔记类型")
      .addText((text) =>
        text
          .setPlaceholder("Basic")
          .setValue(this.plugin.settings.defaultNoteType)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteType = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("直接插入文档")
      .setDesc("启用后，生成的Anki卡片将直接插入到文档末尾，而不是显示在弹窗中")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.insertToDocument)
          .onChange(async (value) => {
            this.plugin.settings.insertToDocument = value;
            await this.plugin.saveSettings();
          })
      );

    // ========== 返回结果解析 ==========
    containerEl.createEl("h3", { text: "返回结果解析" });

    new Setting(containerEl)
      .setName("问题标记符")
      .setDesc("用于识别返回结果中的问题字段，例如：%question%")
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
      .setDesc("用于识别返回结果中的回答字段，例如：%answer%")
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
      .setDesc("用于识别返回结果中的标签字段，例如：%tags%")
      .addText((text) =>
        text
          .setPlaceholder("%tags%")
          .setValue(this.plugin.settings.tagsMarker)
          .onChange(async (value) => {
            this.plugin.settings.tagsMarker = value;
            await this.plugin.saveSettings();
          })
      );

    // ========== 批量增加Anki Deck ==========
    containerEl.createEl("h3", { text: "批量增加Anki Deck" });

    const deckCreationSetting = new Setting(containerEl)
      .setName("批量创建Deck")
      .setDesc("每行输入一个Deck名称，点击按钮批量创建");

    const deckInputContainer = deckCreationSetting.settingEl.createDiv();
    deckInputContainer.style.marginTop = "10px";

    const deckTextArea = deckInputContainer.createEl("textarea");
    deckTextArea.placeholder = "输入Deck名称，每行一个\n例如：\n默认牌组\n英语学习\n数学公式";
    deckTextArea.style.width = "100%";
    deckTextArea.style.minHeight = "150px";
    deckTextArea.style.padding = "10px";
    deckTextArea.style.backgroundColor = "#f5f5f5";
    deckTextArea.style.border = "1px solid #ddd";
    deckTextArea.style.borderRadius = "4px";

    const deckButtonContainer = deckInputContainer.createDiv();
    deckButtonContainer.style.display = "flex";
    deckButtonContainer.style.alignItems = "center";
    deckButtonContainer.style.gap = "10px";
    deckButtonContainer.style.marginTop = "10px";

    const createDeckButton = deckButtonContainer.createEl("button", {
      text: "批量创建Deck",
    });

    const deckCreationStatus = deckButtonContainer.createEl("span");
    deckCreationStatus.style.fontSize = "20px";

    createDeckButton.addEventListener("click", async () => {
      createDeckButton.disabled = true;
      createDeckButton.textContent = "创建中...";
      deckCreationStatus.textContent = "";

      try {
        const deckNames = deckTextArea.value
          .split("\n")
          .map((name) => name.trim())
          .filter((name) => name);

        if (deckNames.length === 0) {
          new Notice("请输入至少一个Deck名称");
          return;
        }

        // 获取Anki中现有的Deck列表
        const existingDecks = await this.plugin.invokeAnkiConnect("deckNames");
        const existingDeckSet = new Set(existingDecks);

        let successCount = 0;
        let errorCount = 0;
        const errorMessages: string[] = [];

        for (const deckName of deckNames) {
          try {
            if (existingDeckSet.has(deckName)) {
              throw new Error(`Deck "${deckName}" 已存在`);
            }
            await this.plugin.invokeAnkiConnect("createDeck", { deck: deckName });
            successCount++;
          } catch (error) {
            console.error(`创建Deck "${deckName}" 失败:`, error);
            errorCount++;
            errorMessages.push(`"${deckName}": ${error.message}`);
          }
        }

        deckCreationStatus.textContent = "✅";
        deckCreationStatus.style.color = "green";
        
        if (errorMessages.length > 0) {
          new Notice(`成功创建 ${successCount} 个Deck，失败 ${errorCount} 个\n失败原因:\n${errorMessages.join("\n")}`);
        } else {
          new Notice(`成功创建 ${successCount} 个Deck`);
        }
      } catch (error) {
        console.error("批量创建Deck失败:", error);
        deckCreationStatus.textContent = "❌";
        deckCreationStatus.style.color = "red";
        new Notice(`批量创建Deck失败: ${error.message}`);
      } finally {
        createDeckButton.disabled = false;
        createDeckButton.textContent = "批量创建Deck";
      }
    });
  }
}
