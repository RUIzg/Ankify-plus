import { AnkiCard } from "./AnkiCard";
import { AnkifySettings } from "./AnkifySettings";

// 卡片解析工具类
export class CardParser {
  private settings: AnkifySettings;

  constructor(settings: AnkifySettings) {
    this.settings = settings;
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
      const headerLine = lines[0].toLowerCase();
      const isTableFormat = headerLine.includes("question") || headerLine.includes("答案") || headerLine.includes("tags");

      if (isTableFormat) {
        console.log("检测到表格格式数据");

        // 解析表头
        const headers = lines[0].split(/\s*[|,;]\s*/).map((header) => header.toLowerCase().trim());
        const questionIndex = headers.findIndex((header) => 
          header.includes("question") || header.includes("问题")
        );
        const answerIndex = headers.findIndex((header) => 
          header.includes("answer") || header.includes("答案")
        );
        const annotationIndex = headers.findIndex((header) => 
          header.includes("annotation") || header.includes("注释")
        );
        const tagsIndex = headers.findIndex((header) => 
          header.includes("tags") || header.includes("标签")
        );

        // 解析数据行
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;

          const values = line.split(/\s*[|,;]\s*/);
          const card: AnkiCard = { 
            question: questionIndex >= 0 ? values[questionIndex] : "", 
            answer: answerIndex >= 0 ? values[answerIndex] : "",
            noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
            originalAnswer: "", // 初始化原始答案为空
            tags: [] // 初始化标签为空数组
          };

          if (annotationIndex >= 0 && values[annotationIndex]) {
            card.annotation = values[annotationIndex];
          }

          if (tagsIndex >= 0 && values[tagsIndex]) {
            const tagsText = values[tagsIndex];
            if (tagsText.includes("#")) {
              // 带#格式：#tag1 #tag2
              card.tags = tagsText
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
            } else {
              // 不带#格式
              card.tags = tagsText
                .split(/[\s,]+/)
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
            }
          }

          // 保存原始答案
          card.originalAnswer = card.answer;
          
          // 检测是否包含填空格式
          if (this.containsClozeFormat(card.answer)) {
            card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
          }

          // 确保卡片至少有问题
          if (card.question) {
            cards.push(card);
          }
        }
      } else {
        console.log("检测到其他格式数据，尝试按分隔符分割");

        // 尝试使用其他常见分隔符分割
        const separators = ["\n---\n", "\n==\n", "\n\n"];
        let cardTexts: string[] = [text];

        for (const separator of separators) {
          if (text.includes(separator)) {
            cardTexts = text.split(separator).map((part) => part.trim()).filter((part) => part);
            break;
          }
        }

        // 处理每个卡片文本
        for (const cardText of cardTexts) {
          const lines = cardText.split("\n").map((line) => line.trim()).filter((line) => line);
          if (lines.length < 2) continue;

          const card: AnkiCard = { 
            question: lines[0], 
            answer: lines.slice(1).join("\n"),
            noteType: this.settings.defaultNoteType, // 默认使用设置中的笔记类型
            originalAnswer: "", // 初始化原始答案为空
            tags: [] // 初始化标签为空数组
          };

          // 保存原始答案
          card.originalAnswer = card.answer;
          
          // 检测是否包含填空格式
          if (this.containsClozeFormat(card.answer)) {
            card.noteType = "Cloze"; // 如果包含填空格式，默认使用Cloze类型
          }

          cards.push(card);
        }
      }
    }

    console.log(`解析出 ${cards.length} 张卡片`, cards);
    return cards;
  }

  // 检测文本是否包含填空格式
  containsClozeFormat(text: string): boolean {
    // 检测是否包含 {{c1::...}} 格式的填空
    return /\{\{c\d+::[^}]+\}\}/.test(text);
  }
}
