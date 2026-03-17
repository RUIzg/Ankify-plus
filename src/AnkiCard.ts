// Anki卡片类型定义

export interface AnkiCard {
  question: string; // 问题
  answer: string; // 答案
  noteType: string; // 笔记类型
  tags: string[]; // 标签
  annotation?: string; // 注释
  originalAnswer?: string; // 原始答案
  backExtra?: string; // 背面额外内容
}
