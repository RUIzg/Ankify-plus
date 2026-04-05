// Anki笔记构建器
import { AnkiCard } from "../AnkiCard";

export class AnkiNoteBuilder {
  private noteTypeFields: Record<string, string[]> = {};
  private invokeAnkiConnect: (action: string, params: any) => Promise<any>;

  constructor(invokeAnkiConnect: (action: string, params: any) => Promise<any>) {
    this.invokeAnkiConnect = invokeAnkiConnect;
  }

  /**
   * 将AnkiCard数组转换为Anki Connect API需要的note对象数组
   * @param cards AnkiCard数组
   * @param deckName 牌组名称
   * @returns note对象数组
   */
  async buildNotes(cards: AnkiCard[], deckName: string): Promise<any[]> {
    return await Promise.all(
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

        return note;
      })
    );
  }
}
