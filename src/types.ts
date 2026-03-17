// 类型定义

export interface AnkifySettings {
  // API设置
  apiModel: string; // 使用的API模型
  deepseekApiKey: string; // DeepSeek API密钥
  deepseekApiUrl: string; // DeepSeek API URL
  openaiApiKey: string; // OpenAI API密钥
  claudeApiKey: string; // Claude API密钥
  doubaoApiKey: string; // 豆包 API 密钥
  doubaoApiUrl: string; // 豆包 API URL
  doubaoModelName: string; // 豆包默认模型
  // 自定义API设置
  customApiUrl: string; // 自定义API URL
  customApiKey: string; // 自定义API密钥
  customModelName: string; // 自定义模型名称
  customApiVersion: string; // 自定义API版本
  // 通用设置
  customPrompt: string; // 自定义提示词
  visionPrompt: string; // 视觉提示词
  maxImageSize: number; // 图片最大尺寸
  imageQuality: number; // 图片质量
  insertToDocument: boolean; // 是否插入到文档
  ankiConnectUrl: string; // Anki Connect地址
  defaultDeck: string; // 默认牌组
  defaultNoteType: string; // 默认笔记类型
  // 返回结果解析设置
  questionMarker: string; // 问题标记符，如 %question%
  answerMarker: string; // 回答标记符，如 %answer%
  tagsMarker: string; // 标签标记符，如 %tags%
}

export interface AnkiCard {
  question: string; // 问题
  answer: string; // 答案
  noteType: string; // 笔记类型
  tags: string[]; // 标签
  annotation?: string; // 注释
  originalAnswer?: string; // 原始答案
  backExtra?: string; // 背面额外内容
}
