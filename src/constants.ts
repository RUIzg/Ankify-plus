// 默认设置和常量定义

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

export const DEFAULT_SETTINGS: AnkifySettings = {
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

export interface AnkiCard {
  question: string; // 问题
  answer: string; // 答案
  noteType: string; // 笔记类型
  tags: string[]; // 标签
  annotation?: string; // 注释
  originalAnswer?: string; // 原始答案
  backExtra?: string; // 背面额外内容
}
