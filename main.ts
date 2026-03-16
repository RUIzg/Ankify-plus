import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import * as http from "http";
import * as https from "https";

// Anki卡片接口
interface AnkiCard {
  question: string;
  answer: string;
  annotation?: string;
  tags?: string[];
  noteType: string; // 卡片的笔记类型
  originalAnswer: string; // 原始答案（用于切换回填空类型时还原）
  backExtra?: string; // Back Extra 字段内容
}

// 默认设置
interface AnkifySettings {
  // API设置
  apiModel: string; // 选择的API模型
  deepseekApiKey: string;
  deepseekApiUrl: string; // DeepSeek API URL
  openaiApiKey: string;
  claudeApiKey: string;
  doubaoApiKey: string; // 豆包 API 密钥
  doubaoApiUrl: string; // 豆包 API URL
  doubaoModelName: string; // 豆包模型名称
  // 自定义API设置
  customApiUrl: string;
  customApiKey: string;
  customModelName: string;
  customApiVersion: string;
  // 通用设置
  customPrompt: string;
  visionPrompt: string; // 图片识别提示词
  maxImageSize: number; // 图片最大尺寸（像素）
  imageQuality: number; // 图片压缩质量（0-1）
  insertToDocument: boolean; // 是否直接插入文档而不是弹窗
  ankiConnectUrl: string; // Anki Connect API地址
  defaultDeck: string; // 默认牌组
  defaultNoteType: string; // 默认笔记类型
  // 返回结果解析设置
  questionMarker: string; // 问题标记符，如 %question%
  answerMarker: string; // 回答标记符，如 %answer%
  tagsMarker: string; // 标签标记符，如 %tags%
}

const DEFAULT_SETTINGS: AnkifySettings = {
  // API设置
  apiModel: "deepseek", // 默认使用DeepSeek
  deepseekApiKey: "",
  deepseekApiUrl: "https://api.deepseek.com/v1/chat/completions", // DeepSeek API URL
  openaiApiKey: "",
  claudeApiKey: "",
  doubaoApiKey: "", // 豆包 API 密钥
  doubaoApiUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", // 豆包 API URL
  doubaoModelName: "doubao-1-5-vision-pro-32k-250115", // 豆包默认模型
  // 自定义API设置
  customApiUrl: "https://api.example.com/v1/chat/completions",
  customApiKey: "",
  customModelName: "custom-model",
  customApiVersion: "",
  // 通用设置
  customPrompt:
    '请基于以下内容创建Anki卡片，格式为"%question%:问题 %answer%:答案 %tags%:#标签"，每个卡片一行。提取关键概念和知识点。\n\n',
  visionPrompt:
    '请识别这张图片中的内容，并基于图片内容创建Anki卡片，格式为"%question%:问题 %answer%:答案 %tags%:#标签"，每个卡片一行。提取图片中的关键概念和知识点。',
  maxImageSize: 1024, // 图片最大尺寸1024px
  imageQuality: 0.8, // 图片质量80%
  insertToDocument: false, // 默认使用弹窗
  ankiConnectUrl: "http://127.0.0.1:8765", // Anki Connect默认地址
  defaultDeck: "Default", // 默认牌组
  defaultNoteType: "Basic", // 默认笔记类型
  // 返回结果解析设置
  questionMarker: "%question%", // 问题标记符
  answerMarker: "%answer%", // 回答标记符
  tagsMarker: "%tags%", // 标签标记符
};

export default class AnkifyPlugin extends Plugin {
  settings: AnkifySettings;
  noteTypeFields: Record<string, string[]> = {}; // 存储笔记类型的字段信息

  async onload() {
    await this.loadSettings();

    // 在编辑器菜单中添加一个命令
    this.addCommand({
      id: "generate-anki-cards",
      name: "生成Anki卡片",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.processContent(editor, view);
      },
    });

    // 添加设置面板
    this.addSettingTab(new AnkifySettingTab(this.app, this));

    // 在编辑器工具栏添加一个按钮
    this.addRibbonIcon("dice", "Ankify选中内容", (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.processContent(view.editor, view);
      } else {
        new Notice("请先打开一个Markdown文件");
      }
    });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 调用Anki Connect API
  async invokeAnkiConnect(action: string, params = {}) {
    const requestBody = {
      action,
      version: 6,
      params,
    };

    console.log("发送Anki Connect请求:", {
      url: this.settings.ankiConnectUrl,
      action,
      params,
    });

    try {
      // 使用Node.js的http/https模块来绕过CORS限制
      const data = await this.sendHttpRequest(this.settings.ankiConnectUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(JSON.stringify(requestBody)),
        },
        body: JSON.stringify(requestBody),
      });

      console.log("Anki Connect响应:", data);

      if (data.error) {
        throw new Error(`Anki Connect错误: ${data.error}`);
      }

      return data.result;
    } catch (error) {
      console.error("Anki Connect请求失败:", error);
      throw new Error(`Anki Connect请求失败: ${error.message}`);
    }
  }

  // 发送HTTP请求的辅助方法（带重试机制）
  async sendHttpRequest(url: string, options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }, retryCount = 3): Promise<any> {
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
            reject(new Error(`解析响应失败: ${error.message}`));
          }
        });
      });

      // 设置超时时间为30秒，避免连接被重置
      req.setTimeout(30000, () => {
        req.destroy();
        if (retryCount > 0) {
          console.log(`请求超时，正在重试... (${retryCount} 次剩余)`);
          this.sendHttpRequest(url, options, retryCount - 1)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error("Anki Connect请求超时，请检查Anki是否正在运行"));
        }
      });

      req.on("error", (error) => {
        // 处理连接错误，添加重试机制
        if ((error.code === "ECONNRESET" || error.code === "ECONNREFUSED") && retryCount > 0) {
          console.log(`连接错误: ${error.code}，正在重试... (${retryCount} 次剩余)`);
          // 延迟1秒后重试，避免立即重试导致的问题
          setTimeout(() => {
            this.sendHttpRequest(url, options, retryCount - 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else if (error.code === "ECONNRESET") {
          reject(new Error("Anki Connect连接被重置，请检查Anki是否正在运行或Anki Connect是否已启用"));
        } else if (error.code === "ECONNREFUSED") {
          reject(new Error("Anki Connect连接被拒绝，请确保Anki已启动且Anki Connect已安装并启用"));
        } else {
          reject(error);
        }
      });

      req.write(options.body);
      req.end();
    });
  }

  // 获取可用的牌组列表
  async getDeckNames() {
    try {
      return await this.invokeAnkiConnect("deckNames");
    } catch (error) {
      console.error("获取牌组列表失败:", error);
      new Notice(
        "获取Anki牌组列表失败，请确保Anki已启动且安装了Anki Connect插件"
      );
      return [];
    }
  }

  // 获取可用的笔记类型列表
  async getNoteTypes() {
    try {
      return await this.invokeAnkiConnect("modelNames");
    } catch (error) {
      console.error("获取笔记类型列表失败:", error);
      return [];
    }
  }

  // 解析生成的Anki卡片文本
  parseAnkiCards(text: string): AnkiCard[] {
    const cards: AnkiCard[] = [];

    console.log("开始解析Anki卡片，原始文本长度:", text.length);
    console.log("原始文本前500字符:", text.substring(0, 500));

    // 检查是否是多行格式（每个字段一行，卡片间有空行）
    const questionMarker = this.settings.questionMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const answerMarker = this.settings.answerMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagsMarker = this.settings.tagsMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isMultiLineFormat = new RegExp(`${questionMarker}.*\\n\\s*${answerMarker}.*?(\\n\\s*annotation:.*)?(\\n\\s*${tagsMarker}.*)?`, "i").test(
      text
    );

    if (isMultiLineFormat) {
      console.log("检测到多行格式数据");

      // 通过标记符分割不同的卡片
      const questionMarkerPattern = new RegExp(questionMarker, "gi");
      const matches = Array.from(text.matchAll(questionMarkerPattern));
      
      if (matches.length === 0) {
        return cards;
      }

      for (let i = 0; i < matches.length; i++) {
        const startMatch = matches[i];
        const endMatch = matches[i + 1];
        
        // 提取当前卡片的内容
        const cardStart = startMatch.index;
        const cardEnd = endMatch ? endMatch.index : text.length;
        const cardText = text.substring(cardStart, cardEnd).trim();
        
        const lines = cardText.split("\n").map((line) => line.trim()).filter((line) => line);
        const card: AnkiCard = { 
          question: "", 
          answer: "",
          noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
          originalAnswer: "", // 初始化原始答案为空
          tags: [] // 初始化标签为空数组
        };

        for (const line of lines) {
          if (line.startsWith(questionMarker)) {
            let content = line.substring(questionMarker.length).trim();
            // 处理冒号分隔符
            if (content.startsWith(":") || content.startsWith("：")) {
              content = content.substring(1).trim();
            }
            card.question = content;
          } else if (line.startsWith(answerMarker)) {
            let content = line.substring(answerMarker.length).trim();
            // 处理冒号分隔符
            if (content.startsWith(":") || content.startsWith("：")) {
              content = content.substring(1).trim();
            }
            card.answer = content;
            card.originalAnswer = card.answer; // 保存原始答案
            
            // 检测是否包含填空格式
            if (this.containsClozeFormat(card.answer)) {
              card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
            }
          } else if (line.startsWith("annotation:") || line.startsWith("注释:") || line.startsWith("注释：")) {
            card.annotation = line.substring(line.indexOf(':') + 1).trim();
          } else if (line.startsWith(tagsMarker)) {
            let content = line.substring(tagsMarker.length).trim();
            // 处理冒号分隔符
            if (content.startsWith(":") || content.startsWith("：")) {
              content = content.substring(1).trim();
            }
            const tagsText = content;
            // 处理标签 - 追加到现有标签数组
            if (tagsText.includes("#")) {
              // 带#格式：#tag1 #tag2
              const newTags = tagsText
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
              card.tags = [...card.tags, ...newTags];
            } else {
              // 不带#格式
              const newTags = tagsText
                .split(/[\s,]+/)
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
              card.tags = [...card.tags, ...newTags];
            }
          }
        }

        // 确保卡片至少有问题
        if (card.question) {
          cards.push(card);
        }
      }
    } else {
      // 检查是否是表格格式
      const lines = text.split("\n").filter((line) => line.trim());

      // 如果没有内容，直接返回空数组
      if (lines.length === 0) {
        return cards;
      }

      // 检查表格格式（第一行包含%question%、%answer%、annotation、%tags%等标题）
      const headerLine = lines[0].trim();
      const isTableFormat = new RegExp(`^${questionMarker}[\\t\\s]+${answerMarker}[\\t\\s]+annotation[\\t\\s]+${tagsMarker}$`, "i").test(
        headerLine
      );

      if (isTableFormat) {
        console.log("检测到表格格式数据");
        // 跳过标题行，解析表格内容
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // 尝试按制表符分割
          let parts: string[];
          if (line.includes("\t")) {
            parts = line.split("\t");
          } else {
            // 使用正则表达式匹配连续空格分隔的部分
            parts = line.split(/\s{2,}/);
          }

          if (parts.length >= 2) {
            const card: AnkiCard = {
              question: parts[0].trim(),
              answer: parts[1].trim(),
              noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
              originalAnswer: parts[1].trim(), // 保存原始答案
              tags: [] // 初始化标签为空数组
            };

            // 检测是否包含填空格式
            if (this.containsClozeFormat(card.answer)) {
              card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
            }

            if (parts.length >= 3 && parts[2].trim()) {
              card.annotation = parts[2].trim();
            }

            if (parts.length >= 4 && parts[3].trim()) {
              // 处理标签 - 支持带#和不带#的格式，追加到现有标签数组
              const tagsText = parts[3].trim();
              if (tagsText) {
                if (tagsText.includes("#")) {
                  // 带#格式：#tag1 #tag2
                  const tagParts = tagsText.split("#");
                  const newTags = tagParts
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                  card.tags = [...card.tags, ...newTags];
                } else {
                  // 不带#格式，假设用空格或逗号分隔
                  const newTags = tagsText
                    .split(/[\s,]+/)
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                  card.tags = [...card.tags, ...newTags];
                }
              }
            }

            cards.push(card);
          }
        }
      } else {
        // 原有的解析逻辑
        for (const line of lines) {
          // 支持新格式：%question% 问题 %answer% 答案
          const qaMatch = line.match(
            new RegExp(`(?:${questionMarker})[:：]?\\s*(.*?)\\s*(?:${answerMarker})[:：]?\\s*(.*?)(?:\\s*annotation:|注释[:：]|$|\\s*${tagsMarker}[:：]?)`, "i")
          );
          if (qaMatch) {
            const card: AnkiCard = {
              question: qaMatch[1]?.trim() || "",
              answer: qaMatch[2]?.trim() || "",
              noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
              originalAnswer: qaMatch[2]?.trim() || "", // 保存原始答案
              tags: [] // 初始化标签为空数组
            };

            // 检测是否包含填空格式
            if (this.containsClozeFormat(card.answer)) {
              card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
            }

            // 查找注释
            const annotationMatch = line.match(
              /(?:annotation:|注释[:：])\s*(.*?)(?:\s*tags:|标签[:：]|$)/i
            );
            if (annotationMatch) {
              card.annotation = annotationMatch[1]?.trim();
            }

            // 查找标签
            const tagsMatch = line.match(new RegExp(`(?:${tagsMarker})[:：]?\\s*(.*?)$`, "i"));
            if (tagsMatch && tagsMatch[1]) {
              // 解析标签，格式为 #tag1 #tag2，追加到现有标签数组
              const newTags = tagsMatch[1]
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
              card.tags = [...card.tags, ...newTags];
            }

            cards.push(card);
          } else {
            // 尝试匹配问题:::答案格式
            const splitLine = line.split(":::");
            if (splitLine.length >= 2) {
              const answer = splitLine[1].trim();
              const card: AnkiCard = {
                question: splitLine[0].trim(),
                answer: answer,
                noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
                originalAnswer: answer, // 保存原始答案
                tags: [] // 初始化标签为空数组
              };
              
              // 检测是否包含填空格式
              if (this.containsClozeFormat(card.answer)) {
                card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
              }
              
              cards.push(card);
            }
          }
        }
      }
    }

    console.log(`解析出 ${cards.length} 张卡片`, cards);
    return cards;
  }

  // 添加卡片到Anki
  async addNotesToAnki(cards: AnkiCard[], deckName: string, noteType: string) {
    // 验证输入参数
    if (!deckName || !noteType) {
      throw new Error("牌组名称和笔记类型不能为空");
    }

    console.log("准备添加卡片到Anki:", {
      deckName,
      noteType,
      cardCount: cards.length,
      firstCard: cards[0],
    });

    const notes = await Promise.all(
      cards.map(async (card, index) => {
        // 验证卡片内容
        if (!card.question) {
          throw new Error(
            `卡片内容不完整：\n问题：${card.question}`
          );
        }

        // 使用卡片自己的笔记类型
        const cardNoteType = card.noteType;

        // 根据笔记类型构建字段映射
        let fields: Record<string, string> = {};

        // 获取笔记类型的字段名称
        const modelFieldNames = await this.invokeAnkiConnect(
          "modelFieldNames",
          { modelName: cardNoteType }
        );
        console.log(`笔记类型 ${cardNoteType} 的字段名称:`, modelFieldNames);
        
        // 存储笔记类型的字段信息
        this.noteTypeFields[cardNoteType] = modelFieldNames;

        // 根据字段名称进行映射
        if (cardNoteType === "Cloze" || cardNoteType === "填空题") {
          // Cloze类型通常只有一个主要字段，通常是Text或正面
          let mainFieldName: string;
          let extraFieldName: string | null = null;
          
          // 确定主要字段和额外字段
          if (modelFieldNames.includes("Text")) {
            mainFieldName = "Text";
            // 优先检查是否有Back Extra字段，然后是Extra字段，最后是Back字段
            if (modelFieldNames.includes("Back Extra")) {
              extraFieldName = "Back Extra";
            } else if (modelFieldNames.includes("Extra")) {
              extraFieldName = "Extra";
            } else if (modelFieldNames.includes("Back")) {
              extraFieldName = "Back";
            }
          } else if (modelFieldNames.includes("正面")) {
            mainFieldName = "正面";
            // 优先检查是否有背面 额外字段，然后是额外字段，最后是背面字段
            if (modelFieldNames.includes("背面 额外")) {
              extraFieldName = "背面 额外";
            } else if (modelFieldNames.includes("额外")) {
              extraFieldName = "额外";
            } else if (modelFieldNames.includes("背面")) {
              extraFieldName = "背面";
            }
          } else if (modelFieldNames.includes("Back")) {
            mainFieldName = "Back";
            // 检查是否有Back Extra字段，然后是Extra字段
            if (modelFieldNames.includes("Back Extra")) {
              extraFieldName = "Back Extra";
            } else if (modelFieldNames.includes("Extra")) {
              extraFieldName = "Extra";
            }
          } else if (modelFieldNames.length > 0) {
            // 使用第一个字段作为主要字段
            mainFieldName = modelFieldNames[0];
            // 检查是否有第二个字段作为额外字段，优先选择Back Extra或其他合适的字段
            for (let i = 1; i < modelFieldNames.length; i++) {
              const field = modelFieldNames[i];
              if (field === "Back Extra" || field === "背面 额外" || field === "Extra" || field === "额外" || field === "Back" || field === "背面") {
                extraFieldName = field;
                break;
              }
            }
            // 如果没有找到合适的字段，使用第二个字段
            if (!extraFieldName && modelFieldNames.length > 1) {
              extraFieldName = modelFieldNames[1];
            }
          } else {
            throw new Error(`无法确定Cloze笔记类型的字段`);
          }
          
          // 构建字段
          // 对于Cloze类型，将问题和答案合并写入到主要字段
          const clozeContent = card.question ? `${card.question}<br><br>${card.answer}` : card.answer;
          fields = {
            [mainFieldName]: clozeContent,
          };
          
          // 如果有额外字段且有注释，将注释放到额外字段
          if (extraFieldName && card.annotation) {
            fields[extraFieldName] = card.annotation;
            console.log(`将注释放入额外字段 ${extraFieldName}:`, card.annotation);
          } else if (card.annotation) {
            // 如果没有额外字段但有注释，仍然追加到主要字段
            fields[mainFieldName] += `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`;
            console.log(`将注释追加到主要字段 ${mainFieldName}:`, card.annotation);
          }
          
          // 如果有 Back Extra 内容，添加到字段中（优先使用专门的 Back Extra 字段）
          console.log(`处理 Back Extra: card.backExtra = "${card.backExtra}", modelFieldNames =`, modelFieldNames);
          if (card.backExtra) {
            if (modelFieldNames.includes("Back Extra")) {
              fields["Back Extra"] = card.backExtra;
              console.log(`将 Back Extra 内容放入 Back Extra 字段:`, card.backExtra);
            } else if (extraFieldName && !card.annotation) {
              // 如果没有专门的 Back Extra 字段，但有其他额外字段且没有注释，使用额外字段
              fields[extraFieldName] = card.backExtra;
              console.log(`将 Back Extra 内容放入额外字段 ${extraFieldName}:`, card.backExtra);
            } else {
              // 如果没有合适的字段，追加到主要字段
              fields[mainFieldName] += `\n<hr>\n${card.backExtra}`;
              console.log(`将 Back Extra 内容追加到主要字段 ${mainFieldName}`);
            }
          } else if (modelFieldNames.includes("Back Extra")) {
            // 即使为空也要添加字段，确保 Anki 能识别
            fields["Back Extra"] = "";
            console.log(`添加空的 Back Extra 字段`);
          }
          
          console.log(`最终字段:`, fields);
        } else if (
          modelFieldNames.includes("Front") &&
          modelFieldNames.includes("Back")
        ) {
          fields = {
            Front: card.question,
            Back:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else if (
          modelFieldNames.includes("正面") &&
          modelFieldNames.includes("背面")
        ) {
          fields = {
            正面: card.question,
            背面:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else if (
          modelFieldNames.includes("Text") &&
          modelFieldNames.includes("Extra")
        ) {
          fields = {
            Text: card.question,
            Extra:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else {
          // 如果无法确定字段名称，尝试使用第一个字段作为问题，第二个字段作为答案
          if (modelFieldNames.length >= 2) {
            fields = {
              [modelFieldNames[0]]: card.question,
              [modelFieldNames[1]]:
                card.answer +
                (card.annotation
                  ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                  : ""),
            };
          } else {
            throw new Error(`无法确定笔记类型 ${cardNoteType} 的字段映射`);
          }
        }

        // 验证字段映射（Back Extra 字段可以为空）
        for (const [key, value] of Object.entries(fields)) {
          if (key !== "Back Extra" && (!value || value.trim() === "")) {
            throw new Error(`字段 "${key}" 不能为空`);
          }
        }

        // 确保ankify标签在最后
        const userTags = (card.tags || []).filter(tag => tag !== "ankify");
        const finalTags = [...userTags, "ankify"];
        
        const note = {
          deckName,
          modelName: cardNoteType,
          fields,
          tags: finalTags,
          options: {
            allowDuplicate: false,
          },
        };

        console.log(`第 ${index + 1} 张卡片的标签:`, finalTags);
        return note;
      })
    );

    // 批量添加笔记（分批处理，每批最多10张卡片）
    try {
      console.log("正在添加笔记到Anki:", {
        deckName,
        noteType,
        noteCount: notes.length,
        firstNote: notes[0],
      });

      const batchSize = 10;
      const allResults: number[] = [];

      // 分批处理卡片
      for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        console.log(`处理第 ${Math.floor(i / batchSize) + 1} 批，共 ${batch.length} 张卡片`);
        
        const result = await this.invokeAnkiConnect("addNotes", { notes: batch });

        // 检查结果
        if (!result || !Array.isArray(result)) {
          throw new Error("Anki Connect返回了无效的结果");
        }

        allResults.push(...result);

        // 检查是否有失败的笔记
        const failedNotes = result.filter((id) => id === null);
        if (failedNotes.length > 0) {
          console.warn(`第 ${Math.floor(i / batchSize) + 1} 批中有 ${failedNotes.length} 张卡片添加失败`);
        }

        // 每批之间休息100ms，避免请求过于频繁
        if (i + batchSize < notes.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return allResults;
    } catch (error) {
      console.error("添加笔记失败:", error);
      throw new Error(`添加笔记失败: ${error.message}`);
    }
  }

  // 解析Markdown图片路径
  parseImagePath(text: string): string | null {
    // 匹配 Markdown 图片格式: ![alt](path)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
    const match = text.match(imageRegex);
    return match ? match[2] : null;
  }

  // 读取图片并转换为base64
  async readImageAsBase64(imagePath: string, currentFilePath: string): Promise<{ base64: string, actualPath: string }> {
    try {
      const vault = this.app.vault;
      const currentFile = this.app.workspace.getActiveFile();

      if (!currentFile) {
        throw new Error("无法获取当前文件");
      }

      console.log("开始读取图片:", {
        原始路径: imagePath,
        当前文件: currentFile.path,
        当前文件目录: currentFile.parent?.path
      });

      let fullPath = imagePath;

      // 首先尝试直接读取（可能是相对于vault根目录的路径）
      let file = vault.getAbstractFileByPath(imagePath);

      if (!file && !imagePath.startsWith('/')) {
        // 如果直接读取失败，尝试相对于当前文件目录
        const currentDir = currentFile.parent?.path || '';
        fullPath = currentDir ? `${currentDir}/${imagePath}` : imagePath;
        console.log("尝试相对路径:", fullPath);
        file = vault.getAbstractFileByPath(fullPath);
      }

      if (!file) {
        // 最后尝试：移除开头的 ./
        if (imagePath.startsWith('./')) {
          const cleanPath = imagePath.substring(2);
          const currentDir = currentFile.parent?.path || '';
          fullPath = currentDir ? `${currentDir}/${cleanPath}` : cleanPath;
          console.log("尝试清理后的路径:", fullPath);
          file = vault.getAbstractFileByPath(fullPath);
        }
      }

      if (!file) {
        console.error("所有路径尝试失败，vault所有文件:", vault.getFiles().map(f => f.path));
        throw new Error(`找不到图片文件。\n尝试的路径: ${imagePath}, ${fullPath}\n请检查图片路径是否正确`);
      }

      const actualPath = file.path;
      console.log("成功找到文件:", actualPath);

      // 读取二进制数据
      const arrayBuffer = await vault.readBinary(file as any);

      // 转换为base64
      const base64Data = this.arrayBufferToBase64(arrayBuffer);

      // 获取文件扩展名以确定MIME类型
      const ext = imagePath.split('.').pop()?.toLowerCase();
      const mimeType = this.getMimeType(ext || '');

      console.log("图片读取成功，大小:", arrayBuffer.byteLength, "bytes");

      return {
        base64: `data:${mimeType};base64,${base64Data}`,
        actualPath: actualPath
      };
    } catch (error) {
      console.error("读取图片失败:", error);
      throw new Error(`读取图片失败: ${error.message}`);
    }
  }

  // ArrayBuffer转Base64
  arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // 获取MIME类型
  getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'image/png';
  }

  // 压缩图片
  async compressImage(base64Image: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();

        img.onload = () => {
          // 计算压缩后的尺寸
          let width = img.width;
          let height = img.height;
          const maxSize = this.settings.maxImageSize;

          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height * maxSize) / width;
              width = maxSize;
            } else {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          // 创建canvas进行压缩
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('无法创建canvas上下文'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // 转换为base64，使用指定的质量
          const compressedBase64 = canvas.toDataURL('image/jpeg', this.settings.imageQuality);

          console.log('图片压缩完成:', {
            原始尺寸: `${img.width}x${img.height}`,
            压缩后尺寸: `${width}x${height}`,
            原始大小: Math.round(base64Image.length / 1024) + 'KB',
            压缩后大小: Math.round(compressedBase64.length / 1024) + 'KB'
          });

          resolve(compressedBase64);
        };

        img.onerror = () => {
          reject(new Error('图片加载失败'));
        };

        img.src = base64Image;
      } catch (error) {
        reject(error);
      }
    });
  }

  async processContent(editor: Editor, view: MarkdownView) {
    // 修改为处理选中的文本，而不是整篇文章
    const selectedText = editor.getSelection();

    if (!selectedText) {
      new Notice("请先选择要处理的文本内容");
      return;
    }

    // 检查是否为图片路径
    const imagePath = this.parseImagePath(selectedText);
    if (imagePath) {
      // 处理图片识别，传递用户实际选中的文本
      await this.processImage(imagePath, selectedText, editor, view);
      return;
    }

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
        new Notice("请先设置自定义API URL");
        return;
      }
      // 检查自定义模型名称
      if (!this.settings.customModelName) {
        new Notice("请先设置自定义模型名称");
        return;
      }
    }

    if (!apiKey) {
      const modelName = model === "deepseek" ? "DeepSeek" :
                        model === "openai" ? "OpenAI" :
                        model === "claude" ? "Claude" :
                        model === "doubao" ? "豆包" : "自定义API";
      new Notice(`请先设置${modelName}密钥`);
      return;
    }

    // 立即弹窗显示
    const usedPrompt = this.settings.customPrompt + selectedText;
    new SelectableCardsModal(
      this.app,
      [],
      "",
      this,
      editor,
      usedPrompt,
      "",
      selectedText,
      async () => {
        // API调用函数
        try {
          const result = await this.callModelAPI(selectedText);
          return { result, cards: this.parseAnkiCards(result) };
        } catch (error) {
          console.error("API调用失败:", error);
          throw error;
        }
      },
      this.settings.insertToDocument
    ).open();
  }

  // 处理图片识别
  async processImage(imagePath: string, selectedText: string, editor: Editor, view: MarkdownView) {
    try {
      const currentFile = this.app.workspace.getActiveFile();
      if (!currentFile) {
        throw new Error("无法获取当前文件");
      }

      const usedPrompt = this.settings.visionPrompt;
      const imageInfo = `原始路径: ${imagePath}\n当前文件: ${currentFile.path}`;

      // 立即弹窗显示
      new SelectableCardsModal(
        this.app,
        [],
        "",
        this,
        editor,
        usedPrompt,
        imageInfo,
        selectedText,  // 显示用户实际选中的内容
        async () => {
          // API调用函数
          try {
            // 读取图片并转为base64
            const { base64: base64Image, actualPath } = await this.readImageAsBase64(imagePath, currentFile.path);

            // 更新图片路径信息
            const updatedImageInfo = `原始路径: ${imagePath}\n实际读取路径: ${actualPath}\n当前文件: ${currentFile.path}`;

            // 压缩图片以减少token使用
            const compressedImage = await this.compressImage(base64Image);

            // 调用Vision API
            const result = await this.callVisionAPI(compressedImage);

            return {
              result,
              cards: this.parseAnkiCards(result),
              imageInfo: updatedImageInfo
            };
          } catch (error) {
            console.error("图片识别失败:", error);
            throw error;
          }
        },
        this.settings.insertToDocument
      ).open();
    } catch (error) {
      console.error("图片识别失败:", error);
      new Notice("图片识别失败：" + error.message);
    }
  }

  // 新增方法：将结果追加到文档末尾
  appendResultToDocument(editor: Editor, result: string) {
    const docContent = editor.getValue();
    const newContent = docContent + "\n\n## Anki卡片\n\n" + result;
    editor.setValue(newContent);
    new Notice("Anki卡片已添加到文档末尾");
  }

  // 检测答案是否包含填空格式
  containsClozeFormat(text: string): boolean {
    // 匹配 {{c数字::内容}} 格式
    const clozePattern = /\{\{c\d+::[^}]+\}\}/g;
    return clozePattern.test(text);
  }

  async callVisionAPI(base64Image: string): Promise<string> {
    const model = this.settings.apiModel;
    let apiUrl = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let requestBody: any = {};

    // 使用专门的图片识别提示词
    const visionPrompt = this.settings.visionPrompt;

    // 根据选择的模型设置API请求参数
    if (model === "deepseek") {
      // 使用配置的 DeepSeek API URL
      apiUrl = this.settings.deepseekApiUrl || "https://api.deepseek.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.deepseekApiKey}`;

      // 判断是否是 V3 API 格式（URL 包含 /v3/）
      const isV3Api = apiUrl.includes('/v3/');

      if (isV3Api) {
        // V3 API 格式 - 类似 Python 示例的格式
        // 提取纯base64数据（移除 data:image/xxx;base64, 前缀）
        const base64Data = base64Image.includes('base64,')
          ? base64Image.split('base64,')[1]
          : base64Image;

        console.log('DeepSeek V3 API 图片识别 - base64数据长度:', base64Data.length);
        console.log('DeepSeek V3 API 图片识别 - base64前100字符:', base64Data.substring(0, 100));

        requestBody = {
          model_version: "v3.0-pro",
          prompt: visionPrompt,
          image_url: `data:image/jpeg;base64,${base64Data}`,  // 使用 base64 数据作为图片 URL
          temperature: 0.7,
          response_format: "text"
        };

        console.log('DeepSeek V3 API 请求体（不含图片数据）:', {
          model_version: requestBody.model_version,
          temperature: requestBody.temperature,
          prompt: requestBody.prompt.substring(0, 100) + '...'
        });
      } else {
        // V1 API 格式 - 原有的 OpenAI 兼容格式
        // 提取纯base64数据（移除 data:image/xxx;base64, 前缀）
        const base64Data = base64Image.includes('base64,')
          ? base64Image.split('base64,')[1]
          : base64Image;

        console.log('DeepSeek V1 API 图片识别 - base64数据长度:', base64Data.length);
        console.log('DeepSeek V1 API 图片识别 - base64前100字符:', base64Data.substring(0, 100));

        // DeepSeek 需要将 content 序列化为 JSON 字符串
        const contentJson = JSON.stringify([
          {
            type: "text",
            text: visionPrompt
          },
          {
            type: "image",
            image: {
              data: base64Data,
              format: "base64"
            }
          }
        ]);

        requestBody = {
          model: "deepseek-chat",
          messages: [
            {
              role: "user",
              content: contentJson
            }
          ],
          temperature: 0.7,
        };

        console.log('DeepSeek V1 API 请求体（不含图片数据）:', {
          model: requestBody.model,
          temperature: requestBody.temperature,
          contentLength: contentJson.length
        });
      }
    } else if (model === "openai") {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
      requestBody = {
        model: "gpt-4-vision-preview", // GPT-4 Vision
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: visionPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: base64Image
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      };
    } else if (model === "claude") {
      apiUrl = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = this.settings.claudeApiKey;
      headers["anthropic-version"] = "2023-06-01";

      // 提取base64数据和媒体类型
      const imageDataMatch = base64Image.match(/data:(image\/\w+);base64,(.+)/);
      const mediaType = imageDataMatch ? imageDataMatch[1] : "image/png";
      const imageData = imageDataMatch ? imageDataMatch[2] : base64Image;

      requestBody = {
        model: "claude-3-haiku-20240307",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageData
                }
              },
              {
                type: "text",
                text: visionPrompt
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      };
    } else if (model === "custom") {
      // 自定义API - 尝试OpenAI格式
      apiUrl = this.settings.customApiUrl;
      headers["Authorization"] = `Bearer ${this.settings.customApiKey}`;

      if (this.settings.customApiVersion) {
        headers["api-version"] = this.settings.customApiVersion;
      }

      requestBody = {
        model: this.settings.customModelName,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: visionPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: base64Image
                }
              }
            ]
          }
        ],
        temperature: 0.7,
      };
    } else if (model === "doubao") {
      // 豆包 API
      apiUrl = this.settings.doubaoApiUrl;
      headers["Authorization"] = `Bearer ${this.settings.doubaoApiKey}`;

      requestBody = {
        model: this.settings.doubaoModelName,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: base64Image
                }
              },
              {
                type: "text",
                text: visionPrompt
              }
            ]
          }
        ]
      };
    } else {
      throw new Error("不支持的模型类型");
    }

    // 发送API请求
    const startTime = Date.now();
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API 错误响应:", errorText);
      let errorMessage = `请求失败: HTTP ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorData.message || errorText;
      } catch (e) {
        errorMessage = errorText || `HTTP ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    // 获取响应文本并检查是否为空
    const responseText = await response.text();
    if (!responseText || responseText.trim() === "") {
      throw new Error("API 返回空响应");
    }

    console.log("API 原始响应:", responseText.substring(0, 500));

    // 解析 JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON 解析失败，原始响应:", responseText);
      throw new Error(`API 返回无效 JSON 格式: ${responseText.substring(0, 200)}`);
    }
    const endTime = Date.now();
    console.log(`${model.toUpperCase()} Vision API响应时间: ${endTime - startTime}ms`);

    // 根据不同API响应格式获取结果
    let result = "";
    if (model === "deepseek") {
      // 判断是否是 V3 API 响应格式
      if (apiUrl.includes('/v3/')) {
        // V3 API 格式
        result = data.response || data.text || data.content || data.result || data.output || data.generated_text || "无法识别图片内容";
      } else {
        // V1 API 格式 (OpenAI 兼容格式)
        result = data.choices[0]?.message?.content || "无法识别图片内容";
      }
    } else if (model === "openai") {
      result = data.choices[0]?.message?.content || "无法识别图片内容";
    } else if (model === "claude") {
      result = data.content[0]?.text || "无法识别图片内容";
    } else if (model === "doubao") {
      result = data.choices[0]?.message?.content || "无法识别图片内容";
    } else if (model === "custom") {
      if (data.choices && data.choices[0]?.message?.content) {
        result = data.choices[0].message.content;
      } else if (data.content && data.content[0]?.text) {
        result = data.content[0].text;
      } else if (data.response) {
        result = data.response;
      } else if (data.text || data.content || data.result || data.output || data.generated_text) {
        result = data.text || data.content || data.result || data.output || data.generated_text;
      } else {
        console.warn("无法从API响应中提取内容，返回完整响应:", data);
        result = JSON.stringify(data, null, 2);
      }
    }

    return result;
  }

  async callModelAPI(content: string): Promise<string> {
    const prompt = this.settings.customPrompt + content;
    const startTime = Date.now();
    const model = this.settings.apiModel;
    let apiUrl = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let requestBody: any = {};

    // 根据选择的模型设置API请求参数
    if (model === "deepseek") {
      apiUrl = "https://api.deepseek.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.deepseekApiKey}`;
      requestBody = {
        model: "deepseek-chat",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      };
    } else if (model === "openai") {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
      requestBody = {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      };
    } else if (model === "claude") {
      apiUrl = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = this.settings.claudeApiKey;
      headers["anthropic-version"] = "2023-06-01";
      requestBody = {
        model: "claude-3-haiku-20240307",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      };
    } else if (model === "doubao") {
      // 豆包 API
      apiUrl = this.settings.doubaoApiUrl;
      headers["Authorization"] = `Bearer ${this.settings.doubaoApiKey}`;
      requestBody = {
        model: this.settings.doubaoModelName,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ]
      };
    } else if (model === "custom") {
      // 使用自定义API设置
      apiUrl = this.settings.customApiUrl;
      headers["Authorization"] = `Bearer ${this.settings.customApiKey}`;
      
      // 如果有指定API版本，添加到请求头
      if (this.settings.customApiVersion) {
        headers["api-version"] = this.settings.customApiVersion;
      }
      
      // 根据URL猜测API类型并设置合适的请求体
      if (apiUrl.includes("openai")) {
        requestBody = {
          model: this.settings.customModelName,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
        };
      } else if (apiUrl.includes("anthropic")) {
        requestBody = {
          model: this.settings.customModelName,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        };
      } else {
        // 默认格式（类似OpenAI）
        requestBody = {
          model: this.settings.customModelName,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
        };
      }
    } else {
      throw new Error("不支持的模型类型");
    }

    // 发送API请求
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API 错误响应:", errorText);
      let errorMessage = `请求失败: HTTP ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorData.message || errorText;
      } catch (e) {
        errorMessage = errorText || `HTTP ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    // 获取响应文本并检查是否为空
    const responseText = await response.text();
    if (!responseText || responseText.trim() === "") {
      throw new Error("API 返回空响应");
    }

    console.log("API 原始响应:", responseText.substring(0, 500));

    // 解析 JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error("JSON 解析失败，原始响应:", responseText);
      throw new Error(`API 返回无效 JSON 格式: ${responseText.substring(0, 200)}`);
    }

    const endTime = Date.now();
    console.log(`${model.toUpperCase()} API响应时间: ${endTime - startTime}ms`);
    
    // 根据不同API响应格式获取结果
    let result = "";
    if (model === "deepseek" || model === "openai" || model === "doubao") {
      result = data.choices[0]?.message?.content || "无法生成卡片内容";
    } else if (model === "claude") {
      result = data.content[0]?.text || "无法生成卡片内容";
    } else if (model === "custom") {
      // 尝试从不同的响应结构中提取内容
      if (data.choices && data.choices[0]?.message?.content) {
        // OpenAI格式
        result = data.choices[0].message.content;
      } else if (data.content && data.content[0]?.text) {
        // Claude格式
        result = data.content[0].text;
      } else if (data.response) {
        // 某些API可能直接返回response字段
        result = data.response;
      } else if (data.text || data.content || data.result || data.output || data.generated_text) {
        // 其他可能的字段名
        result = data.text || data.content || data.result || data.output || data.generated_text;
      } else {
        // 找不到合适的字段，返回整个响应作为JSON字符串
        console.warn("无法从API响应中提取内容，返回完整响应:", data);
        result = JSON.stringify(data, null, 2);
      }
    }
    
    return result;
  }
}

// 卡片选择模态框
class SelectableCardsModal extends Modal {
  cards: AnkiCard[];
  rawResult: string;
  plugin: AnkifyPlugin;
  editor: Editor;
  selectedCards: boolean[];
  deckName: string;
  noteType: string;
  deckSelect: HTMLSelectElement;
  noteTypeSelect: HTMLSelectElement;
  loadingEl: HTMLElement;
  usedPrompt: string; // 实际使用的提示词
  imageInfo: string; // 图片路径信息
  selectedContent: string; // 选中的内容
  apiCallFn: (() => Promise<{ result: string; cards: AnkiCard[]; imageInfo?: string }>) | null; // API调用函数
  insertToDocument: boolean; // 是否直接插入文档

  constructor(
    app: App,
    cards: AnkiCard[],
    rawResult: string,
    plugin: AnkifyPlugin,
    editor: Editor,
    usedPrompt: string = "",
    imageInfo: string = "",
    selectedContent: string = "",
    apiCallFn: (() => Promise<{ result: string; cards: AnkiCard[]; imageInfo?: string }>) | null = null,
    insertToDocument: boolean = false
  ) {
    super(app);
    this.cards = cards;
    this.rawResult = rawResult;
    this.plugin = plugin;
    this.editor = editor;
    this.selectedCards = cards.map(() => true); // 默认全选
    this.deckName = plugin.settings.defaultDeck;
    this.noteType = plugin.settings.defaultNoteType;
    this.usedPrompt = usedPrompt;
    this.imageInfo = imageInfo;
    this.selectedContent = selectedContent;
    this.apiCallFn = apiCallFn;
    this.insertToDocument = insertToDocument;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置模态框为常驻
    this.modalEl.style.position = "fixed";
    this.modalEl.style.top = "50%";
    this.modalEl.style.left = "50%";
    this.modalEl.style.transform = "translate(-50%, -50%)";
    this.modalEl.style.width = "80%";
    this.modalEl.style.maxWidth = "800px";
    this.modalEl.style.maxHeight = "80vh";
    this.modalEl.style.overflow = "auto";

    // 先显示调试信息和加载状态
    this.loadContent();
  }

  async loadContent() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Anki卡片生成" });

    // 先添加请求信息面板（默认折叠）
    this.addRequestInfo(contentEl);

    // 创建加载区域
    const loadingContainer = contentEl.createDiv({ cls: "ankify-loading-container" });
    loadingContainer.style.textAlign = "center";
    loadingContainer.style.padding = "20px";

    const loadingSpinner = loadingContainer.createEl("div", { cls: "ankify-loading-spinner" });
    loadingSpinner.style.fontSize = "24px";
    loadingSpinner.style.marginBottom = "10px";
    loadingSpinner.textContent = "⏳";

    const loadingText = loadingContainer.createEl("div", { text: "正在生成Anki卡片，请稍候..." });
    loadingText.style.fontSize = "14px";
    loadingText.style.color = "#666";

    // 保存图片信息元素引用
    let imageInfoEl: HTMLPreElement | null = null;

    // 如果有API调用函数，执行它
    if (this.apiCallFn) {
      try {
        const apiResult = await this.apiCallFn();
        this.rawResult = apiResult.result;
        this.cards = apiResult.cards;
        this.selectedCards = this.cards.map(() => true); // 重新设置为全选

        // 如果有更新的图片信息，更新显示
        if (apiResult.imageInfo) {
          this.imageInfo = apiResult.imageInfo;
        }

        // 移除加载区域
        loadingContainer.remove();

        // 如果设置了直接插入文档
        if (this.insertToDocument) {
          this.appendResultToDocument(this.editor, this.rawResult);
          this.close();
          return;
        }

        // 渲染卡片内容
        await this.renderCards(contentEl);
        
        // 移除旧的请求信息面板
        const existingRequestInfo = contentEl.querySelector(".ankify-request-info");
        if (existingRequestInfo) {
          existingRequestInfo.remove();
        }
        
        // 在卡片内容之后重新添加请求信息面板
        this.addRequestInfo(contentEl);
      } catch (error) {
        loadingContainer.remove();
        contentEl.createEl("p", {
          text: `生成失败: ${error.message}`,
          cls: "ankify-error"
        }).style.color = "red";
        
        // 移除旧的请求信息面板
        const existingRequestInfo = contentEl.querySelector(".ankify-request-info");
        if (existingRequestInfo) {
          existingRequestInfo.remove();
        }
        
        // 在错误信息之后添加请求信息面板
        this.addRequestInfo(contentEl);
      }
    } else {
      // 没有API调用函数，直接渲染已有的卡片
      loadingContainer.remove();
      
      // 渲染卡片内容
      await this.renderCards(contentEl);
      
      // 移除旧的请求信息面板
      const existingRequestInfo = contentEl.querySelector(".ankify-request-info");
      if (existingRequestInfo) {
        existingRequestInfo.remove();
      }
      
      // 在卡片内容之后添加请求信息面板
      this.addRequestInfo(contentEl);
    }
  }

  // 渲染卡片内容
  async renderCards(contentEl: HTMLElement) {

    if (this.cards.length === 0) {
      contentEl.createEl("p", {
        text: "未能解析出有效的Anki卡片，请检查生成结果格式。",
      });

      // 显示原始结果和编辑选项
      const rawResultEl = contentEl.createDiv({ cls: "ankify-raw-result" });
      const textAreaEl = rawResultEl.createEl("textarea", {
        cls: "ankify-editable-result",
        text: this.rawResult,
      });
      textAreaEl.style.width = "100%";
      textAreaEl.style.height = "100px";

      const buttonContainer = contentEl.createDiv({
        cls: "ankify-button-container",
      });
      const copyButton = buttonContainer.createEl("button", {
        text: "复制内容",
      });
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(textAreaEl.value);
        new Notice("已复制到剪贴板");
      });

      const insertButton = buttonContainer.createEl("button", {
        text: "插入到文档",
      });
      insertButton.addEventListener("click", () => {
        const docContent = this.editor.getValue();
        const newContent =
          docContent + "\n\n## Anki卡片\n\n" + textAreaEl.value;
        this.editor.setValue(newContent);
        new Notice("内容已添加到文档末尾");
        this.close();
      });

      // 添加请求信息到底部
      this.addRequestInfo(contentEl);

      return;
    }

    // Anki设置区域
    const ankiSettingsEl = contentEl.createDiv({ cls: "ankify-anki-settings" });

    // 获取可用牌组
    let decks: string[] = [];
    try {
      decks = await this.plugin.getDeckNames();
    } catch (error) {
      // 如果获取失败，添加一个提示
      ankiSettingsEl.createEl("p", {
        cls: "ankify-error",
        text: "无法连接到Anki。请确保Anki已经启动，且已安装Anki Connect插件。",
      });
    }

    // 牌组选择器
    const deckContainer = ankiSettingsEl.createDiv({
      cls: "ankify-setting-item",
    });
    deckContainer.createEl("label", { text: "选择牌组：" });
    const deckSelectContainer = deckContainer.createDiv({
      style: { display: "flex", alignItems: "center", gap: "10px" }
    });
    this.deckSelect = deckSelectContainer.createEl("select");

    if (decks.length > 0) {
      // 添加可用牌组选项
      decks.forEach((deck) => {
        const option = this.deckSelect.createEl("option", {
          value: deck,
          text: deck,
        });
        if (deck === this.plugin.settings.defaultDeck) {
          option.selected = true;
          this.deckName = deck;
        }
      });
    } else {
      // 如果没有获取到牌组，添加默认选项
      this.deckSelect.createEl("option", {
        value: this.deckName,
        text: this.deckName,
      });
    }

    const refreshDeckButton = deckSelectContainer.createEl("button", {
      text: "刷新",
      attr: { type: "button" },
      style: { padding: "2px 8px", fontSize: "12px" }
    });

    refreshDeckButton.addEventListener("click", async () => {
      refreshDeckButton.disabled = true;
      refreshDeckButton.textContent = "刷新中...";
      
      try {
        const newDecks = await this.plugin.getDeckNames();
        const currentValue = this.deckSelect.value;
        
        // 清空现有选项
        this.deckSelect.innerHTML = "";
        
        if (newDecks.length > 0) {
          // 添加新的牌组选项
          newDecks.forEach((deck) => {
            const option = this.deckSelect.createEl("option", {
              value: deck,
              text: deck,
            });
            // 保持之前选择的牌组，如果还存在的话
            if (deck === currentValue) {
              option.selected = true;
              this.deckName = deck;
            }
          });
          new Notice("牌组列表已刷新");
        } else {
          // 如果没有获取到牌组，添加默认选项
          this.deckSelect.createEl("option", {
            value: this.deckName,
            text: this.deckName,
          });
        }
      } catch (error) {
        console.error("刷新牌组失败:", error);
        new Notice("刷新牌组失败，请确保Anki已启动且安装了Anki Connect插件");
      } finally {
        refreshDeckButton.disabled = false;
        refreshDeckButton.textContent = "刷新";
      }
    });

    this.deckSelect.addEventListener("change", () => {
      this.deckName = this.deckSelect.value;
    });

    // 笔记类型选择器
    const noteTypes = await this.plugin.getNoteTypes();
    const noteTypeContainer = ankiSettingsEl.createDiv({
      cls: "ankify-setting-item",
    });
    noteTypeContainer.createEl("label", { text: "笔记类型：" });
    this.noteTypeSelect = noteTypeContainer.createEl("select");

    if (noteTypes.length > 0) {
      noteTypes.forEach((type: string) => {
        const option = this.noteTypeSelect.createEl("option", {
          value: type,
          text: type,
        });
        if (type === this.plugin.settings.defaultNoteType) {
          option.selected = true;
          this.noteType = type;
        }
      });
    } else {
      // 默认笔记类型选项
      const basicTypes = [
        "Basic",
        "Basic (and reversed card)",
        "Cloze",
        "Basic (optional reversed card)",
      ];
      basicTypes.forEach((type) => {
        const option = this.noteTypeSelect.createEl("option", {
          value: type,
          text: type,
        });
        if (type === this.plugin.settings.defaultNoteType) {
          option.selected = true;
          this.noteType = type;
        }
      });
    }

    this.noteTypeSelect.addEventListener("change", () => {
      this.noteType = this.noteTypeSelect.value;
    });

    // 卡片选择区域
    const cardsContainer = contentEl.createDiv({
      cls: "ankify-cards-container",
    });

    // 添加全选/全不选按钮
    const selectAllContainer = cardsContainer.createDiv({
      cls: "ankify-select-all",
    });
    const selectAllCheckbox = selectAllContainer.createEl("input", {
      type: "checkbox",
    });
    selectAllCheckbox.checked = true;
    selectAllContainer.createEl("label", { text: "全选/全不选" });

    selectAllCheckbox.addEventListener("change", () => {
      this.selectedCards = this.selectedCards.map(
        () => selectAllCheckbox.checked
      );
      this.updateCardSelectionDisplay();
      updateSelectionCount();
    });

    // 卡片列表
    const cardsListEl = cardsContainer.createDiv({ cls: "ankify-cards-list" });

    // 获取可用的笔记类型（复用之前获取的noteTypes）
    const availableNoteTypes = noteTypes.length > 0 ? noteTypes : [
      "Basic",
      "Basic (and reversed card)",
      "Cloze",
      "Basic (optional reversed card)",
    ];

    // 添加选择数量显示
    const selectionCountEl = selectAllContainer.createEl("span", {
      text: ` (已选择 ${this.selectedCards.filter(Boolean).length}/${this.selectedCards.length})`,
      cls: "ankify-selection-count",
    });
    selectionCountEl.style.marginLeft = "10px";
    selectionCountEl.style.color = "var(--text-muted)";

    // 更新选择数量
    const updateSelectionCount = () => {
      const selectedCount = this.selectedCards.filter(Boolean).length;
      const totalCount = this.selectedCards.length;
      selectionCountEl.textContent = ` (已选择 ${selectedCount}/${totalCount})`;
    };

    this.cards.forEach((card, index) => {
      const cardEl = cardsListEl.createDiv({ cls: "ankify-card" });

      // 添加选择框
      const checkboxContainer = cardEl.createDiv({
        cls: "ankify-card-checkbox",
      });
      const checkbox = checkboxContainer.createEl("input", {
        type: "checkbox",
        attr: { id: `card-checkbox-${index}` },
      });
      checkbox.checked = this.selectedCards[index];

      checkbox.addEventListener("change", () => {
        this.selectedCards[index] = checkbox.checked;
        updateSelectionCount();
      });

      // 卡片内容展示
      const cardContent = cardEl.createDiv({ cls: "ankify-card-content" });

      // 问题编辑
      const questionEl = cardContent.createDiv({ cls: "ankify-card-question" });
      questionEl.createEl("strong", { text: `问题${index + 1}: ` });
      const questionInput = questionEl.createEl("input", {
        cls: "ankify-card-input",
        type: "text",
        value: card.question,
      });
      questionInput.addEventListener("change", () => {
        this.cards[index].question = questionInput.value;
      });

      // 答案编辑
      const answerEl = cardContent.createDiv({ cls: "ankify-card-answer" });
      answerEl.createEl("strong", { text: `答案${index + 1}: ` });
      // 将<br>标签替换为实际换行符，便于编辑
      const displayAnswer = card.answer.replace(/<br\s*\/?>/gi, "\n");
      const answerTextarea = answerEl.createEl("textarea", {
        cls: "ankify-card-textarea",
        text: displayAnswer,
      });
      answerTextarea.style.width = "100%";
      answerTextarea.style.minHeight = "100px";
      answerTextarea.style.padding = "8px";
      answerTextarea.style.border = "1px solid var(--border-color)";
      answerTextarea.style.borderRadius = "4px";
      answerTextarea.style.backgroundColor = "var(--background-primary)";
      answerTextarea.style.color = "var(--text-normal)";
      answerTextarea.style.fontFamily = "inherit";
      answerTextarea.style.resize = "vertical";
      answerTextarea.addEventListener("change", () => {
        // 将实际换行符转换回<br>标签，保持数据一致性
        const storedAnswer = answerTextarea.value.replace(/\n/g, "<br>");
        this.cards[index].answer = storedAnswer;
      });

      // 编辑工具栏
      const toolbarEl = answerEl.createDiv({ cls: "ankify-card-toolbar" });
      toolbarEl.style.display = "flex";
      toolbarEl.style.gap = "10px";
      toolbarEl.style.marginTop = "5px";
      toolbarEl.style.alignItems = "center";
      toolbarEl.style.position = "relative"; // 为颜色选择器提供相对定位的父容器

      // 填空按钮（仅在Cloze类型时显示）
      const blankButton = toolbarEl.createEl("button", {
        text: "填空",
      });
      blankButton.style.padding = "4px 8px";
      blankButton.style.fontSize = "12px";
      blankButton.style.backgroundColor = "var(--interactive-accent)";
      blankButton.style.color = "var(--text-on-accent)";
      blankButton.style.border = "none";
      blankButton.style.borderRadius = "4px";
      blankButton.style.cursor = "pointer";
      
      // 颜色选择器按钮
      const colorButton = toolbarEl.createEl("button", {
        text: "标颜色",
      });
      colorButton.style.padding = "4px 8px";
      colorButton.style.fontSize = "12px";
      colorButton.style.backgroundColor = "var(--background-secondary)";
      colorButton.style.color = "var(--text-normal)";
      colorButton.style.border = "1px solid var(--border-color)";
      colorButton.style.borderRadius = "4px";
      colorButton.style.cursor = "pointer";

      // 颜色选择器
      const colorPickerContainer = toolbarEl.createDiv({
        style: { 
          display: "none", 
          position: "absolute", 
          backgroundColor: "var(--background-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "4px",
          padding: "10px",
          zIndex: "10000", // 提高z-index确保显示在最前面
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
          top: "100%", // 相对于父容器的底部
          left: "0", // 相对于父容器的左侧
          marginTop: "5px" // 与按钮保持一定距离
        }
      });

      // 颜色选项
      const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
      colors.forEach(color => {
        const colorOption = colorPickerContainer.createEl("div", {
          style: {
            width: "20px",
            height: "20px",
            backgroundColor: color,
            borderRadius: "50%",
            cursor: "pointer",
            display: "inline-block",
            margin: "2px"
          }
        });
        colorOption.addEventListener("click", () => {
          const start = answerTextarea.selectionStart;
          const end = answerTextarea.selectionEnd;
          const selectedText = answerTextarea.value.substring(start, end);
          
          if (selectedText) {
            // 生成带颜色的文本
            const coloredText = `<span style="color: ${color};">${selectedText}</span>`;
            const newText = answerTextarea.value.substring(0, start) + coloredText + answerTextarea.value.substring(end);
            answerTextarea.value = newText;
            
            // 更新卡片数据
            const storedText = newText.replace(/\n/g, "<br>");
            card.answer = storedText;
            card.originalAnswer = storedText;
            
            // 重新聚焦并设置光标位置
            answerTextarea.focus();
            const newCursorPos = start + coloredText.length;
            answerTextarea.setSelectionRange(newCursorPos, newCursorPos);
          }
          
          // 隐藏颜色选择器
          colorPickerContainer.style.display = "none";
        });
      });

      // 切换颜色选择器显示
      colorButton.addEventListener("click", (e) => {
        e.stopPropagation();
        if (colorPickerContainer.style.display === "none") {
          colorPickerContainer.style.display = "block";
        } else {
          colorPickerContainer.style.display = "none";
        }
      });

      // 点击其他地方隐藏颜色选择器
      document.addEventListener("click", (e) => {
        if (!colorButton.contains(e.target as Node) && !colorPickerContainer.contains(e.target as Node)) {
          colorPickerContainer.style.display = "none";
        }
      });
      
      // 控制按钮显示状态
      const updateBlankButtonVisibility = () => {
        if (card.noteType === "Cloze") {
          blankButton.style.display = "inline-block";
        } else {
          blankButton.style.display = "none";
        }
      };
      
      // 初始显示状态
      updateBlankButtonVisibility();
      
      // 点击填空按钮
      blankButton.addEventListener("click", () => {
        const start = answerTextarea.selectionStart;
        const end = answerTextarea.selectionEnd;
        const selectedText = answerTextarea.value.substring(start, end);
        
        if (selectedText) {
          // 计算当前最大序号
          const text = answerTextarea.value;
          const clozePattern = /\{\{c(\d+)::[^}]+\}\}/g;
          let maxNumber = 0;
          let match;
          while ((match = clozePattern.exec(text)) !== null) {
            const number = parseInt(match[1], 10);
            if (number > maxNumber) {
              maxNumber = number;
            }
          }
          
          // 生成新的序号
          const newNumber = maxNumber + 1;
          
          // 替换选中文本为填空格式
          const newText = text.substring(0, start) + `{{c${newNumber}::${selectedText}}}` + text.substring(end);
          answerTextarea.value = newText;
          
          // 将实际换行符转换回<br>标签，保持数据一致性
          const storedText = newText.replace(/\n/g, "<br>");
          
          // 更新卡片数据
          card.answer = storedText;
          card.originalAnswer = storedText; // 同时更新原始答案
          
          // 重新聚焦并设置光标位置
          answerTextarea.focus();
          const newCursorPos = start + `{{c${newNumber}::${selectedText}}}`.length;
          answerTextarea.setSelectionRange(newCursorPos, newCursorPos);
        }
      });

      // 笔记类型选择器
      const noteTypeContainer = cardContent.createDiv({ cls: "ankify-card-note-type" });
      noteTypeContainer.createEl("strong", { text: "笔记类型: " });
      const noteTypeSelect = noteTypeContainer.createEl("select");
      noteTypeSelect.style.marginLeft = "5px";

      // 添加笔记类型选项
      availableNoteTypes.forEach((type) => {
        const option = noteTypeSelect.createEl("option", {
          value: type,
          text: type,
        });
        if (type === card.noteType) {
          option.selected = true;
        }
      });

      // Back Extra 文本框（仅在Cloze类型时显示，默认折叠）
      const backExtraContainer = cardContent.createDiv({ cls: "ankify-card-back-extra-container" });
      backExtraContainer.style.marginTop = "10px";
      
      // Back Extra 标题和折叠按钮
      const backExtraHeader = backExtraContainer.createEl("div");
      backExtraHeader.style.display = "flex";
      backExtraHeader.style.alignItems = "center";
      backExtraHeader.style.cursor = "pointer";
      backExtraHeader.style.padding = "5px 0";
      
      const backExtraToggle = backExtraHeader.createEl("span", { text: "▶" });
      backExtraToggle.style.marginRight = "5px";
      backExtraToggle.style.color = "var(--text-muted)";
      backExtraToggle.style.fontSize = "12px";
      
      backExtraHeader.createEl("strong", { text: "Back Extra" });
      
      // Back Extra 内容区域（默认隐藏）
      const backExtraContent = backExtraContainer.createDiv({ cls: "ankify-card-back-extra" });
      backExtraContent.style.display = "none";
      backExtraContent.style.marginTop = "5px";
      
      const backExtraTextarea = backExtraContent.createEl("textarea", {
        cls: "ankify-card-textarea",
        text: card.backExtra || "",
      });
      backExtraTextarea.style.width = "100%";
      backExtraTextarea.style.minHeight = "60px";
      backExtraTextarea.style.padding = "8px";
      backExtraTextarea.style.border = "1px solid var(--border-color)";
      backExtraTextarea.style.borderRadius = "4px";
      backExtraTextarea.style.backgroundColor = "var(--background-primary)";
      backExtraTextarea.style.color = "var(--text-normal)";
      backExtraTextarea.style.fontFamily = "inherit";
      backExtraTextarea.style.resize = "vertical";
      backExtraTextarea.addEventListener("input", () => {
        // 将实际换行符转换回<br>标签，保持数据一致性
        const storedBackExtra = backExtraTextarea.value.replace(/\n/g, "<br>");
        this.cards[index].backExtra = storedBackExtra;
      });
      
      // 切换折叠状态
      backExtraHeader.addEventListener("click", () => {
        if (backExtraContent.style.display === "none") {
          backExtraContent.style.display = "block";
          backExtraToggle.textContent = "▼";
        } else {
          backExtraContent.style.display = "none";
          backExtraToggle.textContent = "▶";
        }
      });
      
      // 控制Back Extra容器显示状态
      const updateBackExtraVisibility = () => {
        if (card.noteType === "Cloze") {
          backExtraContainer.style.display = "block";
        } else {
          backExtraContainer.style.display = "none";
        }
      };
      
      // 初始显示状态
      updateBackExtraVisibility();

      // 笔记类型变更事件
      noteTypeSelect.addEventListener("change", () => {
        const newNoteType = noteTypeSelect.value;
        const oldNoteType = card.noteType;
        
        // 保存新的笔记类型
        card.noteType = newNoteType;
        
        // 更新填空按钮显示状态
        updateBlankButtonVisibility();
        // 更新Back Extra文本框显示状态
        updateBackExtraVisibility();
        
        // 处理内容变更
        if (newNoteType === "Cloze") {
          // 切换到Cloze类型，还原原始答案
          card.answer = card.originalAnswer;
          // 将<br>标签替换为实际换行符，便于编辑
          answerTextarea.value = card.answer.replace(/<br\s*\/?>/gi, "\n");
        } else if (oldNoteType === "Cloze" && newNoteType !== "Cloze") {
          // 从Cloze类型切换到其他类型，移除填空标记
          card.answer = card.answer.replace(/\{\{c\d+::([^}]+)\}\}/g, "$1");
          // 将<br>标签替换为实际换行符，便于编辑
          answerTextarea.value = card.answer.replace(/<br\s*\/?>/gi, "\n");
        }
      });

      // 注释编辑
      if (card.annotation) {
        const annotationEl = cardContent.createDiv({
          cls: "ankify-card-annotation",
        });
        annotationEl.createEl("strong", { text: "注释: " });
        const annotationInput = annotationEl.createEl("input", {
          cls: "ankify-card-input",
          type: "text",
          value: card.annotation,
        });
        annotationInput.addEventListener("change", () => {
          this.cards[index].annotation = annotationInput.value;
        });
      }

      // 标签编辑
      const tagsEl = cardContent.createDiv({ cls: "ankify-card-tags" });
      tagsEl.createEl("strong", { text: "标签: " });
      const tagsInput = tagsEl.createEl("input", {
        cls: "ankify-card-input",
        type: "text",
        value: (card.tags || []).join(" "),
        placeholder: "输入标签，用空格分隔",
      });
      tagsInput.addEventListener("change", () => {
        this.cards[index].tags = tagsInput.value
          .split(/\s+/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
      });
    });

    // 统一替换标签区域（可收缩）
    const batchTagsContainer = contentEl.createDiv({
      cls: "ankify-batch-tags-container",
    });
    batchTagsContainer.style.marginTop = "20px";
    
    // 标题和折叠按钮
    const batchTagsHeader = batchTagsContainer.createEl("div");
    batchTagsHeader.style.display = "flex";
    batchTagsHeader.style.justifyContent = "space-between";
    batchTagsHeader.style.alignItems = "center";
    batchTagsHeader.style.cursor = "pointer";
    batchTagsHeader.style.padding = "10px";
    batchTagsHeader.style.backgroundColor = "var(--background-secondary)";
    batchTagsHeader.style.border = "1px solid var(--border-color)";
    batchTagsHeader.style.borderRadius = "4px";
    batchTagsHeader.style.color = "var(--text-normal)";
    
    const batchTagsTitle = batchTagsHeader.createEl("h4", { text: "批量替换标签" });
    batchTagsTitle.style.margin = "0";
    batchTagsTitle.style.fontSize = "14px";
    batchTagsTitle.style.color = "var(--text-normal)";
    
    const batchTagsToggle = batchTagsHeader.createEl("span", { text: "▼" });
    batchTagsToggle.style.color = "var(--text-muted)";
    
    // 内容区域，默认隐藏
    const batchTagsContent = batchTagsContainer.createEl("div");
    batchTagsContent.style.display = "none";
    batchTagsContent.style.padding = "15px";
    batchTagsContent.style.backgroundColor = "var(--background-secondary)";
    batchTagsContent.style.border = "1px solid var(--border-color)";
    batchTagsContent.style.borderTop = "none";
    batchTagsContent.style.borderRadius = "0 0 4px 4px";
    batchTagsContent.style.color = "var(--text-normal)";
    
    // 切换折叠状态
    batchTagsHeader.addEventListener("click", () => {
      if (batchTagsContent.style.display === "none") {
        batchTagsContent.style.display = "block";
        batchTagsToggle.textContent = "▲";
      } else {
        batchTagsContent.style.display = "none";
        batchTagsToggle.textContent = "▼";
      }
    });
    
    // 旧标签输入框
    const oldTagInput = batchTagsContent.createEl("input", {
      type: "text",
      placeholder: "输入要替换的标签",
    });
    oldTagInput.style.width = "100%";
    oldTagInput.style.padding = "8px";
    oldTagInput.style.marginBottom = "10px";
    oldTagInput.style.border = "1px solid var(--border-color)";
    oldTagInput.style.borderRadius = "4px";
    oldTagInput.style.backgroundColor = "var(--background-primary)";
    oldTagInput.style.color = "var(--text-normal)";
    
    // 新标签输入框
    const newTagInput = batchTagsContent.createEl("input", {
      type: "text",
      placeholder: "输入新的标签",
    });
    newTagInput.style.width = "100%";
    newTagInput.style.padding = "8px";
    newTagInput.style.marginBottom = "10px";
    newTagInput.style.border = "1px solid var(--border-color)";
    newTagInput.style.borderRadius = "4px";
    newTagInput.style.backgroundColor = "var(--background-primary)";
    newTagInput.style.color = "var(--text-normal)";
    
    // 整个替换勾选框
    const replaceAllCheckbox = batchTagsContent.createEl("input", {
      type: "checkbox",
      id: "replace-all-tags",
    });
    const replaceAllLabel = batchTagsContent.createEl("label", {
      text: " 整个替换（替换所有标签）",
      for: "replace-all-tags",
    });
    replaceAllLabel.style.marginBottom = "15px";
    replaceAllLabel.style.display = "block";
    replaceAllLabel.style.color = "var(--text-normal)";
    
    // 替换按钮
    const replaceTagsButton = batchTagsContent.createEl("button", {
      text: "替换标签",
    });
    replaceTagsButton.style.padding = "8px 16px";
    replaceTagsButton.style.backgroundColor = "var(--interactive-accent)";
    replaceTagsButton.style.color = "var(--text-on-accent)";
    replaceTagsButton.style.border = "none";
    replaceTagsButton.style.borderRadius = "4px";
    replaceTagsButton.style.cursor = "pointer";
    
    replaceTagsButton.addEventListener("click", () => {
      const oldTag = oldTagInput.value.trim();
      const newTag = newTagInput.value.trim();
      const replaceAll = replaceAllCheckbox.checked;
      
      let changes = 0;
      
      // 更新所有卡片的标签
      this.cards.forEach((card, index) => {
        if (replaceAll) {
          // 整个替换
          const newTags = newTag
            .split(/\s+/)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
          this.cards[index].tags = [...newTags];
          changes++;
        } else {
          // 只替换单个标签
          if (oldTag) {
            const updatedTags = (card.tags || []).map(tag => 
              tag === oldTag ? newTag : tag
            ).filter(tag => tag.length > 0);
            if (JSON.stringify(updatedTags) !== JSON.stringify(card.tags)) {
              this.cards[index].tags = updatedTags;
              changes++;
            }
          }
        }
      });
      
      // 刷新界面显示
      const allTagsInputs = contentEl.querySelectorAll(".ankify-card-tags input");
      allTagsInputs.forEach((input, index) => {
        (input as HTMLInputElement).value = this.cards[index].tags?.join(" ") || "";
      });
      
      if (changes > 0) {
        if (replaceAll) {
          new Notice(`已替换所有卡片的标签为: ${newTag || "(空)"}`);
        } else {
          new Notice(`已将标签 "${oldTag}" 替换为 "${newTag}"，共修改了 ${changes} 张卡片`);
        }
      } else {
        new Notice("没有进行任何替换");
      }
    });

    // 按钮区域
    const buttonContainer = contentEl.createDiv({
      cls: "ankify-button-container",
    });

    // 添加到Anki按钮
    const addToAnkiButton = buttonContainer.createEl("button", {
      cls: "ankify-primary-button",
      text: "添加到Anki",
    });

    addToAnkiButton.addEventListener("click", async () => {
      // 获取选中的卡片
      const selectedCardsList = this.cards.filter(
        (_, index) => this.selectedCards[index]
      );

      if (selectedCardsList.length === 0) {
        new Notice("请至少选择一张卡片");
        return;
      }

      try {
        // 显示加载提示
        const loadingNotice = new Notice("正在添加卡片到Anki...", 0);
        const result = await this.plugin.addNotesToAnki(
          selectedCardsList,
          this.deckName,
          this.noteType
        );

        // 记住用户的选择作为默认值
        this.plugin.settings.defaultDeck = this.deckName;
        this.plugin.settings.defaultNoteType = this.noteType;
        await this.plugin.saveSettings();

        // 显示添加成功的卡片数量
        const successCount = result.filter((id: any) => id !== null).length;
        loadingNotice.hide();
        new Notice(
          `成功添加 ${successCount}/${selectedCardsList.length} 张卡片到Anki`
        );
        this.close();
      } catch (error) {
        new Notice(`添加卡片失败: ${error.message}`);
      }
    });

    // 复制内容按钮
    const copyButton = buttonContainer.createEl("button", {
      text: "复制全部内容",
    });
    copyButton.addEventListener("click", () => {
      navigator.clipboard.writeText(this.rawResult);
      new Notice("已复制原始内容到剪贴板");
    });

    // 插入到文档按钮
    const insertButton = buttonContainer.createEl("button", {
      text: "插入到文档",
    });
    insertButton.addEventListener("click", () => {
      const docContent = this.editor.getValue();
      const newContent = docContent + "\n\n## Anki卡片\n\n" + this.rawResult;
      this.editor.setValue(newContent);
      new Notice("内容已添加到文档末尾");
      this.close();
    });
  }

  // 将结果追加到文档末尾
  appendResultToDocument(editor: Editor, result: string) {
    const docContent = editor.getValue();
    const newContent = docContent + "\n\n## Anki卡片\n\n" + result;
    editor.setValue(newContent);
    new Notice("Anki卡片已添加到文档末尾");
  }

  // 更新卡片选择框状态
  updateCardSelectionDisplay() {
    this.selectedCards.forEach((isSelected, index) => {
      const checkbox = document.getElementById(
        `card-checkbox-${index}`
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = isSelected;
      }
    });
  }

  // 添加请求信息（默认折叠，放到底部）
  addRequestInfo(contentEl: HTMLElement) {
    // 显示请求信息（默认折叠）
    const requestInfoContainer = contentEl.createDiv({ cls: "ankify-request-info" });
    requestInfoContainer.style.marginTop = "20px";
    
    // 标题和折叠按钮
    const header = requestInfoContainer.createEl("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.cursor = "pointer";
    header.style.padding = "10px";
    header.style.backgroundColor = "var(--background-secondary)";
    header.style.border = "1px solid var(--border-color)";
    header.style.borderRadius = "4px";
    header.style.color = "var(--text-normal)";
    
    const title = header.createEl("h3", { text: "请求信息 (点击展开)" });
    title.style.margin = "0";
    title.style.fontSize = "14px";
    title.style.color = "var(--text-normal)";
    
    const toggle = header.createEl("span", { text: "▼" });
    toggle.style.color = "var(--text-muted)";
    
    // 内容区域，默认隐藏
    const content = requestInfoContainer.createEl("div");
    content.style.display = "none";
    content.style.padding = "10px";
    content.style.backgroundColor = "var(--background-secondary)";
    content.style.border = "1px solid var(--border-color)";
    content.style.borderTop = "none";
    content.style.borderRadius = "0 0 4px 4px";
    content.style.color = "var(--text-normal)";
    
    // 切换折叠状态
    header.addEventListener("click", () => {
      if (content.style.display === "none") {
        content.style.display = "block";
        toggle.textContent = "▲";
        title.textContent = "请求信息 (点击收起)";
      } else {
        content.style.display = "none";
        toggle.textContent = "▼";
        title.textContent = "请求信息 (点击展开)";
      }
    });

    // 显示图片路径信息
    if (this.imageInfo) {
      const imageInfoHeader = content.createEl("h4", { text: "图片路径信息:" });
      imageInfoHeader.style.color = "var(--text-normal)";
      const imageInfoEl = content.createEl("pre", {
        text: this.imageInfo,
      });
      imageInfoEl.style.fontFamily = "monospace";
      imageInfoEl.style.fontSize = "12px";
      imageInfoEl.style.backgroundColor = "var(--background-primary)";
      imageInfoEl.style.border = "1px solid var(--border-color)";
      imageInfoEl.style.padding = "8px";
      imageInfoEl.style.borderRadius = "4px";
      imageInfoEl.style.marginBottom = "10px";
      imageInfoEl.style.whiteSpace = "pre-wrap";
      imageInfoEl.style.wordBreak = "break-all";
      imageInfoEl.style.color = "var(--text-normal)";
    }

    // 显示提示词
    if (this.usedPrompt) {
      const promptHeader = content.createEl("h4", { text: "使用的提示词:" });
      promptHeader.style.color = "var(--text-normal)";
      const promptTextArea = content.createEl("textarea", {
        cls: "ankify-debug-prompt",
        text: this.usedPrompt,
      });
      promptTextArea.style.width = "100%";
      promptTextArea.style.minHeight = "80px";
      promptTextArea.style.fontFamily = "monospace";
      promptTextArea.style.fontSize = "12px";
      promptTextArea.style.backgroundColor = "var(--background-primary)";
      promptTextArea.style.border = "1px solid var(--border-color)";
      promptTextArea.style.padding = "8px";
      promptTextArea.style.borderRadius = "4px";
      promptTextArea.style.marginBottom = "10px";
      promptTextArea.style.color = "var(--text-normal)";
      promptTextArea.readOnly = true;
    }

    // 显示选中的内容
    if (this.selectedContent) {
      const contentHeader = content.createEl("h4", { text: "选中的内容:" });
      contentHeader.style.color = "var(--text-normal)";
      const contentTextArea = content.createEl("textarea", {
        cls: "ankify-debug-content",
        text: this.selectedContent,
      });
      contentTextArea.style.width = "100%";
      contentTextArea.style.minHeight = "100px";
      contentTextArea.style.fontFamily = "monospace";
      contentTextArea.style.fontSize = "12px";
      contentTextArea.style.backgroundColor = "var(--background-primary)";
      contentTextArea.style.border = "1px solid var(--border-color)";
      contentTextArea.style.padding = "8px";
      contentTextArea.style.borderRadius = "4px";
      contentTextArea.style.marginBottom = "10px";
      contentTextArea.style.color = "var(--text-normal)";
      contentTextArea.readOnly = true;
    }

    // 显示笔记类型字段信息
    if (Object.keys(this.plugin.noteTypeFields).length > 0) {
      const noteTypeHeader = content.createEl("h4", { text: "笔记类型字段信息:" });
      noteTypeHeader.style.color = "var(--text-normal)";
      const noteTypeFieldsEl = content.createEl("pre", {
        text: Object.entries(this.plugin.noteTypeFields)
          .map(([noteType, fields]) => `${noteType}: ${fields.join(", ")}`)
          .join("\n"),
      });
      noteTypeFieldsEl.style.fontFamily = "monospace";
      noteTypeFieldsEl.style.fontSize = "12px";
      noteTypeFieldsEl.style.backgroundColor = "var(--background-primary)";
      noteTypeFieldsEl.style.border = "1px solid var(--border-color)";
      noteTypeFieldsEl.style.padding = "8px";
      noteTypeFieldsEl.style.borderRadius = "4px";
      noteTypeFieldsEl.style.marginBottom = "10px";
      noteTypeFieldsEl.style.whiteSpace = "pre-wrap";
      noteTypeFieldsEl.style.wordBreak = "break-all";
      noteTypeFieldsEl.style.color = "var(--text-normal)";
    }

    // 显示大模型接口的原始返回信息
    if (this.rawResult) {
      const rawResultHeader = content.createEl("h4", { text: "大模型接口原始返回信息:" });
      rawResultHeader.style.color = "var(--text-normal)";
      const rawResultEl = content.createEl("textarea", {
        cls: "ankify-debug-raw-result",
        text: this.rawResult,
      });
      rawResultEl.style.width = "100%";
      rawResultEl.style.minHeight = "150px";
      rawResultEl.style.fontFamily = "monospace";
      rawResultEl.style.fontSize = "12px";
      rawResultEl.style.backgroundColor = "var(--background-primary)";
      rawResultEl.style.border = "1px solid var(--border-color)";
      rawResultEl.style.padding = "8px";
      rawResultEl.style.borderRadius = "4px";
      rawResultEl.style.marginBottom = "10px";
      rawResultEl.style.color = "var(--text-normal)";
      rawResultEl.readOnly = true;
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// 设置面板
class AnkifySettingTab extends PluginSettingTab {
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
  }
}
