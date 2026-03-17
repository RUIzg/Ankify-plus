import * as https from "https";
import * as http from "http";
import { AnkifySettings } from "./AnkifySettings";
import { AnkiCard } from "./AnkiCard";

// API服务类
export class ApiService {
  private settings: AnkifySettings;

  constructor(settings: AnkifySettings) {
    this.settings = settings;
  }

  // 调用大模型API
  async callModelAPI(
    content: string,
    imageInfo: string = "",
    selectedContent: string = ""
  ): Promise<{ result: string; cards: AnkiCard[]; imageInfo?: string }> {
    const messages = this.constructMessages(content, imageInfo, selectedContent);
    const apiUrl = this.getApiUrl();
    const apiKey = this.getApiKey();
    const model = this.getModel();

    try {
      const response = await this.sendApiRequest(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      console.log("API响应:", response);

      if (!response.choices || response.choices.length === 0) {
        throw new Error("API响应格式不正确");
      }

      const result = response.choices[0].message.content;
      return { result, cards: [], imageInfo };
    } catch (error) {
      console.error("API调用失败:", error);
      throw new Error(`API调用失败: ${error.message}`);
    }
  }

  // 调用视觉API
  async callVisionAPI(
    content: string,
    imageBase64: string,
    imageInfo: string = ""
  ): Promise<{ result: string; cards: AnkiCard[]; imageInfo?: string }> {
    const messages = this.constructVisionMessages(content, imageBase64);
    const apiUrl = this.getApiUrl();
    const apiKey = this.getApiKey();
    const model = this.getModel();

    try {
      const response = await this.sendApiRequest(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      console.log("视觉API响应:", response);

      if (!response.choices || response.choices.length === 0) {
        throw new Error("API响应格式不正确");
      }

      const result = response.choices[0].message.content;
      return { result, cards: [], imageInfo };
    } catch (error) {
      console.error("视觉API调用失败:", error);
      throw new Error(`视觉API调用失败: ${error.message}`);
    }
  }

  // 构建消息
  private constructMessages(
    content: string,
    imageInfo: string = "",
    selectedContent: string = ""
  ) {
    let systemPrompt = this.settings.systemPrompt || `你是一个专注于Anki卡片生成的助手，擅长将复杂的知识内容转化为清晰、结构化的问答形式。\n\n请遵循以下规则：\n1. 识别内容的核心知识点，忽略无关信息\n2. 为每个核心知识点生成一个Anki卡片，包含问题和答案\n3. 问题应该简洁明了，直击要点\n4. 答案应该详细、准确，包含必要的解释和例子\n5. 对于复杂的概念，可以使用分层结构或列表形式\n6. 确保生成的内容符合Anki卡片的格式要求\n7. 为卡片添加相关的标签，使用空格分隔\n8. 如果内容中包含填空格式（如{{c1::...}}），请保持其格式\n\n输出格式：\n问题: [问题内容]\n答案: [答案内容]\n标签: [标签内容]\n\n请确保输出的内容严格按照上述格式，不要包含任何额外的说明或解释。`;

    // 替换占位符
    if (systemPrompt.includes("{{questionMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{questionMarker\}\}/g, this.settings.questionMarker);
    }
    if (systemPrompt.includes("{{answerMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{answerMarker\}\}/g, this.settings.answerMarker);
    }
    if (systemPrompt.includes("{{tagsMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{tagsMarker\}\}/g, this.settings.tagsMarker);
    }

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: content,
      },
    ];

    return messages;
  }

  // 构建视觉API消息
  private constructVisionMessages(content: string, imageBase64: string) {
    let systemPrompt = this.settings.systemPrompt || `你是一个专注于Anki卡片生成的助手，擅长将图片和文本内容转化为清晰、结构化的问答形式。\n\n请遵循以下规则：\n1. 分析图片内容，提取关键信息\n2. 结合文本内容，生成相关的Anki卡片\n3. 问题应该简洁明了，直击要点\n4. 答案应该详细、准确，包含必要的解释和例子\n5. 对于复杂的概念，可以使用分层结构或列表形式\n6. 确保生成的内容符合Anki卡片的格式要求\n7. 为卡片添加相关的标签，使用空格分隔\n8. 如果内容中包含填空格式（如{{c1::...}}），请保持其格式\n\n输出格式：\n问题: [问题内容]\n答案: [答案内容]\n标签: [标签内容]\n\n请确保输出的内容严格按照上述格式，不要包含任何额外的说明或解释。`;

    // 替换占位符
    if (systemPrompt.includes("{{questionMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{questionMarker\}\}/g, this.settings.questionMarker);
    }
    if (systemPrompt.includes("{{answerMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{answerMarker\}\}/g, this.settings.answerMarker);
    }
    if (systemPrompt.includes("{{tagsMarker}}")) {
      systemPrompt = systemPrompt.replace(/\{\{tagsMarker\}\}/g, this.settings.tagsMarker);
    }

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: content,
          },
          {
            type: "image_url",
            image_url: {
              url: imageBase64,
            },
          },
        ],
      },
    ];

    return messages;
  }

  // 发送API请求
  private async sendApiRequest(url: string, options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: options.headers,
      };

      const req = client.request(reqOptions, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (error) {
            reject(new Error(`解析API响应失败: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(options.body);
      req.end();
    });
  }

  // 获取API URL
  private getApiUrl(): string {
    switch (this.settings.apiModel) {
      case "deepseek":
        return this.settings.deepseekApiUrl || "https://api.deepseek.com/v1/chat/completions";
      case "openai":
        return this.settings.openaiApiUrl || "https://api.openai.com/v1/chat/completions";
      case "azure":
        return this.settings.azureApiUrl || "";
      case "gemini":
        return this.settings.geminiApiUrl || "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-lite:generateContent";
      case "ollama":
        return this.settings.ollamaApiUrl || "http://localhost:11434/api/chat";
      case "custom":
        return this.settings.customApiUrl || "";
      default:
        return this.settings.deepseekApiUrl || "https://api.deepseek.com/v1/chat/completions";
    }
  }

  // 获取API密钥
  private getApiKey(): string {
    switch (this.settings.apiModel) {
      case "deepseek":
        return this.settings.deepseekApiKey || "";
      case "openai":
        return this.settings.openaiApiKey || "";
      case "azure":
        return this.settings.azureApiKey || "";
      case "gemini":
        return this.settings.geminiApiKey || "";
      case "custom":
        return this.settings.customApiKey || "";
      default:
        return this.settings.deepseekApiKey || "";
    }
  }

  // 获取模型名称
  private getModel(): string {
    switch (this.settings.apiModel) {
      case "deepseek":
        return this.settings.deepseekModel || "deepseek-chat";
      case "openai":
        return this.settings.openaiModel || "gpt-3.5-turbo";
      case "azure":
        return this.settings.azureModel || "gpt-35-turbo";
      case "gemini":
        return this.settings.geminiModel || "gemini-1.5-flash-lite";
      case "ollama":
        return this.settings.ollamaModel || "llama3";
      case "custom":
        return this.settings.customModel || "";
      default:
        return this.settings.deepseekModel || "deepseek-chat";
    }
  }
}
