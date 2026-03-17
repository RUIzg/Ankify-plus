import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
} from "obsidian";
import * as http from "http";
import * as https from "https";
import { AnkifySettings, AnkiCard } from "./types";
import { DEFAULT_SETTINGS } from "./constants";
import { CardEditorModal } from "./CardEditorModal";
import { AnkifySettingTab } from "./AnkifySettingTab";

export class AnkifyPlugin extends Plugin {
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
      throw new Error(`获取牌组列表失败: ${error.message}`);
    }
  }

  // 获取可用的笔记类型列表
  async getNoteTypes() {
    try {
      return await this.invokeAnkiConnect("modelNames");
    } catch (error) {
      console.error("获取笔记类型列表失败:", error);
      throw new Error(`获取笔记类型列表失败: ${error.message}`);
    }
  }

  // 解析卡片内容
  parseCards(content: string): AnkiCard[] {
    const cards: AnkiCard[] = [];
    const lines = content.split("\n");

    const questionMarker = this.settings.questionMarker;
    const answerMarker = this.settings.answerMarker;
    const tagsMarker = this.settings.tagsMarker;

    lines.forEach((line) => {
      line = line.trim();
      if (!line) return;

      // 尝试匹配带标记的格式: %question%:问题 %answer%:答案 %tags%:#标签
      if (line.includes(questionMarker) && line.includes(answerMarker)) {
        const questionMatch = line.match(new RegExp(`(?:${questionMarker})[:：]\s*(.*?)(?:\s*${answerMarker}|$)`));
        const answerMatch = line.match(new RegExp(`(?:${answerMarker})[:：]\s*(.*?)(?:\s*${tagsMarker}|$)`));
        const tagsMatch = line.match(new RegExp(`(?:${tagsMarker})[:：]?\s*(.*?)$`));

        if (questionMatch && answerMatch) {
          const question = questionMatch[1]?.trim();
          const answer = answerMatch[1]?.trim();
          const tags = tagsMatch && tagsMatch[1]
            ? tagsMatch[1]
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0)
            : [];

          // 检测是否包含填空格式
          const containsCloze = this.containsClozeFormat(answer);

          const card: AnkiCard = {
            question: question || "",
            answer: answer || "",
            noteType: containsCloze ? "Cloze" : this.settings.defaultNoteType,
            tags: tags,
            originalAnswer: answer || "", // 保存原始答案
          };

          // 查找注释
          const annotationMatch = line.match(
            /(?:annotation:|注释[:：])\s*(.*?)(?:\s*tags:|标签[:：]|$)/i
          );
          if (annotationMatch) {
            card.annotation = annotationMatch[1]?.trim();
          }

          // 查找标签
          const tagsMatch2 = line.match(new RegExp(`(?:${tagsMarker})[:：]?\s*(.*?)$`, "i"));
          if (tagsMatch2 && tagsMatch2[1]) {
            // 解析标签，格式为 #tag1 #tag2，追加到现有标签数组
            const newTags = tagsMatch2[1]
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
              tags: [], // 初始化标签为空数组
              originalAnswer: answer, // 保存原始答案
            };
            
            // 检测是否包含填空格式
            if (this.containsClozeFormat(card.answer)) {
              card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
            }
            
            cards.push(card);
          }
        }
      } else if (line.includes(":::")) {
        // 尝试匹配问题:::答案格式
        const splitLine = line.split(":::");
        if (splitLine.length >= 2) {
          const answer = splitLine[1].trim();
          const card: AnkiCard = {
            question: splitLine[0].trim(),
            answer: answer,
            noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
            tags: [], // 初始化标签为空数组
            originalAnswer: answer, // 保存原始答案
          };
          
          // 检测是否包含填空格式
          if (this.containsClozeFormat(card.answer)) {
            card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
          }
          
          cards.push(card);
        }
      }
    });

    console.log(`解析出 ${cards.length} 张卡片`, cards);
    return cards;
  }

  // 检测文本是否包含填空格式
  containsClozeFormat(text: string): boolean {
    return /\{\{c\d+::.+?\}\}/.test(text);
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
      const extension = actualPath.split('.').pop()?.toLowerCase();
      let mimeType = 'image/jpeg';
      if (extension === 'png') {
        mimeType = 'image/png';
      } else if (extension === 'gif') {
        mimeType = 'image/gif';
      } else if (extension === 'webp') {
        mimeType = 'image/webp';
      }

      // 构建完整的base64字符串
      const base64 = `data:${mimeType};base64,${base64Data}`;
      console.log("图片转换成功，base64长度:", base64.length);

      return { base64, actualPath };
    } catch (error) {
      console.error("读取图片失败:", error);
      throw new Error(`读取图片失败: ${error.message}`);
    }
  }

  // 将ArrayBuffer转换为base64
  arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // 压缩图片
  async compressImage(base64: string, maxSize: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        // 从base64创建Image对象
        const img = new Image();
        img.onload = () => {
          // 创建canvas
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // 计算压缩后的尺寸
          if (width > height && width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          } else if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }

          canvas.width = width;
          canvas.height = height;

          // 绘制并压缩图片
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('无法创建canvas上下文'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // 转换回base64
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        };
        img.onerror = () => {
          reject(new Error('图片加载失败'));
        };
        img.src = base64;
      } catch (error) {
        reject(error);
      }
    });
  }

  // 调用AI API生成卡片
  async generateCards(content: string, imagePath?: string): Promise<string> {
    try {
      let prompt = this.settings.customPrompt + content;
      let apiKey = '';
      let apiUrl = '';
      let modelName = '';
      let apiVersion = '';

      // 根据选择的API模型设置相应的参数
      switch (this.settings.apiModel) {
        case 'deepseek':
          apiKey = this.settings.deepseekApiKey;
          apiUrl = this.settings.deepseekApiUrl;
          modelName = 'deepseek-chat';
          break;
        case 'openai':
          apiKey = this.settings.openaiApiKey;
          apiUrl = 'https://api.openai.com/v1/chat/completions';
          modelName = 'gpt-3.5-turbo';
          break;
        case 'claude':
          apiKey = this.settings.claudeApiKey;
          apiUrl = 'https://api.anthropic.com/v1/messages';
          modelName = 'claude-3-opus-20240229';
          break;
        case 'doubao':
          apiKey = this.settings.doubaoApiKey;
          apiUrl = this.settings.doubaoApiUrl;
          modelName = this.settings.doubaoModelName;
          break;
        case 'custom':
          apiKey = this.settings.customApiKey;
          apiUrl = this.settings.customApiUrl;
          modelName = this.settings.customModelName;
          apiVersion = this.settings.customApiVersion;
          break;
        default:
          throw new Error('未选择API模型');
      }

      if (!apiKey) {
        throw new Error(`请在设置中配置${this.settings.apiModel}的API密钥`);
      }

      // 如果有图片路径，处理图片
      let imageBase64 = '';
      if (imagePath) {
        const { base64 } = await this.readImageAsBase64(imagePath, '');
        // 压缩图片
        imageBase64 = await this.compressImage(base64, this.settings.maxImageSize, this.settings.imageQuality);
        prompt = this.settings.visionPrompt;
      }

      console.log(`调用${this.settings.apiModel} API生成卡片`);

      // 构建请求体
      let requestBody: any = {};
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      switch (this.settings.apiModel) {
        case 'deepseek':
          headers['Authorization'] = `Bearer ${apiKey}`;
          requestBody = {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: '你是一个专业的Anki卡片生成助手，能够基于给定的内容生成高质量的Anki卡片。',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
          };
          break;
        case 'openai':
          headers['Authorization'] = `Bearer ${apiKey}`;
          requestBody = {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: '你是一个专业的Anki卡片生成助手，能够基于给定的内容生成高质量的Anki卡片。',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
          };
          break;
        case 'claude':
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          requestBody = {
            model: modelName,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
          };
          break;
        case 'doubao':
          headers['Authorization'] = `Bearer ${apiKey}`;
          requestBody = {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: '你是一个专业的Anki卡片生成助手，能够基于给定的内容生成高质量的Anki卡片。',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
          };
          break;
        case 'custom':
          headers['Authorization'] = `Bearer ${apiKey}`;
          if (apiVersion) {
            headers['api-version'] = apiVersion;
          }
          requestBody = {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: '你是一个专业的Anki卡片生成助手，能够基于给定的内容生成高质量的Anki卡片。',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
          };
          break;
      }

      // 如果有图片，添加到请求体
      if (imageBase64) {
        // 对于支持图片的API，修改请求体
        switch (this.settings.apiModel) {
          case 'openai':
          case 'doubao':
            requestBody.messages[1].content = [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                },
              },
            ];
            break;
          case 'claude':
            requestBody.messages[0].content = [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64.split(',')[1], // 移除data:image/jpeg;base64,前缀
                },
              },
            ];
            break;
          default:
            throw new Error(`${this.settings.apiModel} API不支持图片输入`);
        }
      }

      console.log('发送API请求:', {
        url: apiUrl,
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k === 'Authorization' ? '***' : v])),
        body: JSON.stringify(requestBody),
      });

      // 发送请求
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API请求失败: ${response.statusText}\n${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      console.log('API响应:', data);

      // 解析响应
      let result = '';
      switch (this.settings.apiModel) {
        case 'deepseek':
        case 'openai':
        case 'doubao':
          result = data.choices[0].message.content;
          break;
        case 'claude':
          result = data.content[0].text;
          break;
        case 'custom':
          // 假设自定义API的响应格式与OpenAI类似
          result = data.choices[0].message.content;
          break;
      }

      console.log('生成的卡片内容:', result);
      return result;
    } catch (error) {
      console.error('生成卡片失败:', error);
      throw new Error(`生成卡片失败: ${error.message}`);
    }
  }

  // 处理内容并生成卡片
  async processContent(editor: Editor, view: MarkdownView) {
    try {
      const selectedText = editor.getSelection();
      if (!selectedText) {
        new Notice('请先选择要处理的内容');
        return;
      }

      // 显示加载提示
      const loadingNotice = new Notice('正在生成Anki卡片...');

      // 检查是否包含图片
      const imagePath = this.parseImagePath(selectedText);

      // 调用AI API生成卡片
      const result = await this.generateCards(selectedText, imagePath);

      // 解析生成的卡片
      const cards = this.parseCards(result);

      // 隐藏加载提示
      loadingNotice.hide();

      if (cards.length === 0) {
        new Notice('未能生成有效的Anki卡片');
        return;
      }

      // 根据设置决定是直接插入还是显示编辑弹窗
      if (this.settings.insertToDocument) {
        // 直接插入到文档
        const cardText = cards
          .map(
            (card) =>
              `${this.settings.questionMarker}:${card.question} ${this.settings.answerMarker}:${card.answer} ${this.settings.tagsMarker}:${(card.tags || []).map((tag) => `#${tag}`).join(' ')}`
          )
          .join('\n');

        editor.replaceSelection(cardText);
        new Notice(`成功生成 ${cards.length} 张卡片并插入到文档`);
      } else {
        // 显示编辑弹窗
        new CardEditorModal(this.app, this, cards, async (editedCards) => {
          if (editedCards.length === 0) {
            new Notice('未保存任何卡片');
            return;
          }

          try {
            // 显示加载提示
            const saveLoadingNotice = new Notice('正在保存卡片到Anki...');

            // 添加卡片到Anki
            const result = await this.addNotesToAnki(
              editedCards,
              this.settings.defaultDeck,
              this.settings.defaultNoteType
            );

            // 隐藏加载提示
            saveLoadingNotice.hide();

            // 检查结果
            const successCount = result.filter((id) => id !== null).length;
            new Notice(`成功添加 ${successCount} 张卡片到Anki`);
          } catch (error) {
            new Notice(`添加卡片失败: ${error.message}`);
          }
        }).open();
      }
    } catch (error) {
      new Notice(`处理内容失败: ${error.message}`);
      console.error('处理内容失败:', error);
    }
  }
}
