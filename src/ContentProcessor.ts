import { Editor, Notice } from "obsidian";
import { AnkifySettings } from "./AnkifySettings";
import { AnkiCard } from "./AnkiCard";
import { ImageUtils } from "./ImageUtils";
import { CardParser } from "./CardParser";
import { ApiService } from "./ApiService";

// 内容处理服务类
export class ContentProcessor {
  private settings: AnkifySettings;
  private imageUtils: ImageUtils;
  private cardParser: CardParser;
  private apiService: ApiService;

  constructor(settings: AnkifySettings) {
    this.settings = settings;
    this.imageUtils = new ImageUtils();
    this.cardParser = new CardParser(settings);
    this.apiService = new ApiService(settings);
  }

  // 处理内容
  async processContent(
    content: string,
    editor: Editor,
    currentFilePath: string,
    insertToDocument: boolean = false
  ): Promise<{ result: string; cards: AnkiCard[]; imageInfo?: string }> {
    let imageInfo = "";
    let selectedContent = content;

    // 检查选择的模型对应的API密钥是否已设置
    let apiKey = "";
    const model = this.settings.apiModel;

    if (model === "deepseek") {
      apiKey = this.settings.deepseekApiKey;
    } else if (model === "openai") {
      apiKey = this.settings.openaiApiKey;
    } else if (model === "claude") {
      apiKey = this.settings.claudeApiKey;
    } else if (model === "doubao") {
      apiKey = this.settings.doubaoApiKey;
    } else if (model === "custom") {
      apiKey = this.settings.customApiKey;
      // 检查自定义API URL
      if (!this.settings.customApiUrl) {
        throw new Error("请先设置自定义API URL");
      }
      // 检查自定义模型名称
      if (!this.settings.customModelName) {
        throw new Error("请先设置自定义模型名称");
      }
    }

    if (!apiKey) {
      const modelName = model === "deepseek" ? "DeepSeek" :
                        model === "openai" ? "OpenAI" :
                        model === "claude" ? "Claude" :
                        model === "doubao" ? "豆包" : "自定义API";
      throw new Error(`请先设置${modelName}密钥`);
    }

    // 尝试提取图片
    const imagePath = this.imageUtils.parseImagePath(content);
    if (imagePath) {
      try {
        imageInfo = `提取到图片路径: ${imagePath}`;
        console.log(imageInfo);

        // 读取图片并转换为base64
        const { base64, actualPath } = await this.imageUtils.readImageAsBase64(
          imagePath,
          currentFilePath
        );
        imageInfo += `\n实际路径: ${actualPath}`;

        // 调用视觉API
        const response = await this.apiService.callVisionAPI(content, base64, imageInfo);
        const cards = this.cardParser.parseAnkiCards(response.result);
        return { ...response, cards };
      } catch (error) {
        console.error("处理图片失败:", error);
        imageInfo += `\n处理失败: ${error.message}`;
        // 继续使用文本API
      }
    }

    // 调用文本API
    const response = await this.apiService.callModelAPI(content, imageInfo, selectedContent);
    const cards = this.cardParser.parseAnkiCards(response.result);
    return { ...response, cards };
  }

  // 处理图片
  async processImage(
    imagePath: string,
    currentFilePath: string
  ): Promise<{ base64: string; actualPath: string }> {
    return await this.imageUtils.readImageAsBase64(imagePath, currentFilePath);
  }

  // 解析卡片
  parseCards(text: string): AnkiCard[] {
    return this.cardParser.parseAnkiCards(text);
  }

  // 检查是否包含填空格式
  containsClozeFormat(text: string): boolean {
    return this.cardParser.containsClozeFormat(text);
  }

  // 将结果追加到文档末尾
  appendResultToDocument(editor: Editor, result: string) {
    const docContent = editor.getValue();
    const newContent = docContent + "\n\n## Anki卡片\n\n" + result;
    editor.setValue(newContent);
    new Notice("Anki卡片已添加到文档末尾");
  }
}
