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
import { AnkifySettings } from "./src/AnkifySettings";
import { AnkiCard } from "./src/AnkiCard";
import { DEFAULT_SETTINGS } from "./src/constants";
import { SelectableCardsModal } from "./src/SelectableCardsModal";
import { AnkifySettingTab } from "./src/AnkifySettingTab";

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
  async addNotesToAnki(cards: AnkiCard[], deckName: string, noteType: string, progressCallback?: (current: number, total: number) => void) {
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
        const finalTags = [...userTags];
        
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

        // 调用进度回调
        if (progressCallback) {
          const current = Math.min(i + batch.length, notes.length);
          progressCallback(current, notes.length);
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




