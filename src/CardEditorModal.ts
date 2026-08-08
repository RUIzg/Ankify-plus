import { App, Modal } from "obsidian";
import { AnkiCard } from "./AnkiCard";
import { AnkifyPlugin } from "./AnkifyPlugin";

// 卡片编辑弹窗
export class CardEditorModal extends Modal {
  plugin: AnkifyPlugin;
  cards: AnkiCard[];
  onSubmit: (cards: AnkiCard[]) => void;

  constructor(
    app: App,
    plugin: AnkifyPlugin,
    cards: AnkiCard[],
    onSubmit: (cards: AnkiCard[]) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.cards = cards;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ankify-modal");

    // 添加标题
    contentEl.createEl("h2", { text: "编辑Anki卡片" });

    // 添加卡片列表
    this.cards.forEach((card, index) => {
      const cardEl = contentEl.createEl("div", { cls: "ankify-card" });
      cardEl.createEl("h3", { text: `卡片 ${index + 1}` });

      // 问题输入框
      const questionTextarea = cardEl.createEl("textarea");
      questionTextarea.value = card.question;
      questionTextarea.placeholder = "请输入问题";
      questionTextarea.addEventListener("input", (e) => {
        card.question = (e.target as HTMLTextAreaElement).value;
      });

      // 答案输入框
      const answerTextarea = cardEl.createEl("textarea");
      answerTextarea.value = card.answer;
      answerTextarea.placeholder = "请输入答案";
      answerTextarea.addEventListener("input", (e) => {
        card.answer = (e.target as HTMLTextAreaElement).value;
      });

      // 标签输入框
      const tagsInput = cardEl.createEl("input");
      tagsInput.type = "text";
      tagsInput.value = (card.tags || []).join(" ");
      tagsInput.placeholder = "请输入标签，用空格分隔";
      tagsInput.addEventListener("input", (e) => {
        card.tags = (e.target as HTMLInputElement).value
          .split(" ")
          .filter((tag) => tag.trim() !== "");
      });

      // 卡片操作
      const cardActions = cardEl.createEl("div", { cls: "card-actions" });
      
      // 切换为填空类型按钮
      const toggleClozeBtn = cardActions.createEl("button", { 
        text: card.noteType === "Cloze" ? "切换为问答类型" : "切换为填空类型",
        cls: "btn-secondary"
      });
      toggleClozeBtn.addEventListener("click", () => {
        if (card.noteType === "Cloze") {
          // 从填空类型切换为问答类型
          card.noteType = "Basic";
          // 还原原始答案
          if (card.originalAnswer) {
            card.answer = card.originalAnswer;
            answerTextarea.value = card.answer;
          }
          toggleClozeBtn.textContent = "切换为填空类型";
        } else {
          // 从问答类型切换为填空类型
          // 保存原始答案
          card.originalAnswer = card.answer;
          // 转换为填空格式
          card.answer = card.answer.replace(/(\d+)\.\s*(.+?)(?=\n\d+\.\s*|$)/g, "{{c$1::$2}}");
          card.noteType = "Cloze";
          answerTextarea.value = card.answer;
          toggleClozeBtn.textContent = "切换为问答类型";
        }
      });

      // 删除卡片按钮
      const deleteBtn = cardActions.createEl("button", { 
        text: "删除",
        cls: "btn-secondary"
      });
      deleteBtn.addEventListener("click", () => {
        cardEl.remove();
        this.cards.splice(index, 1);
      });
    });

    // 添加提示信息
    contentEl.createEl("div", {
      cls: "ankify-notes",
      text: "提示：点击'切换为填空类型'按钮可以将卡片转换为填空题格式，点击'删除'按钮可以删除卡片。",
    });

    // 添加底部按钮
    const controls = contentEl.createEl("div", { cls: "ankify-controls" });
    
    // 取消按钮
    const cancelBtn = controls.createEl("button", { 
      text: "取消",
      cls: "btn-secondary"
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    // 清空按钮
    const clearBtn = controls.createEl("button", { 
      text: "清空",
      cls: "btn-secondary"
    });
    clearBtn.addEventListener("click", () => {
      if (confirm("确定要清空所有卡片吗？")) {
        this.cards = [];
        contentEl.innerHTML = "";
        this.onOpen();
      }
    });

    // 确定按钮
    const confirmBtn = controls.createEl("button", { 
      text: "确定",
      cls: "btn-primary"
    });
    confirmBtn.addEventListener("click", () => {
      this.onSubmit(this.cards);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
