import * as http from "http";
import * as https from "https";
import { AnkifySettings } from "./AnkifySettings";
import { AnkiCard } from "./AnkiCard";

// Anki Connect 服务类
export class AnkiConnectService {
  private settings: AnkifySettings;
  public noteTypeFields: Record<string, string[]> = {};

  constructor(settings: AnkifySettings) {
    this.settings = settings;
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
}
