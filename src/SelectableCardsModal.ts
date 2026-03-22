import { App, Editor, Modal } from "obsidian";
import { AnkiCard } from "./AnkiCard";
import { AnkifyPlugin } from "../main";
import { Notice } from "obsidian";

// 卡片选择模态框
export class SelectableCardsModal extends Modal {
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
    this.deckName = plugin.settings.lastUsedDeck || plugin.settings.defaultDeck;
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
        if (deck === this.plugin.settings.lastUsedDeck) {
          option.selected = true;
          this.deckName = deck;
        } else if (deck === this.plugin.settings.defaultDeck && !this.deckSelect.value) {
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
      // 撤销历史记录
      const undoHistory: string[] = [answerTextarea.value];
      
      // 保存当前状态到历史记录
      const saveToHistory = () => {
        undoHistory.push(answerTextarea.value);
        // 限制历史记录数量，避免内存占用过大
        if (undoHistory.length > 50) {
          undoHistory.shift();
        }
      };
      
      // 撤销操作
      const undo = () => {
        if (undoHistory.length > 1) {
          undoHistory.pop(); // 移除当前状态
          const previousState = undoHistory[undoHistory.length - 1];
          answerTextarea.value = previousState;
          
          // 更新卡片数据
          const storedText = previousState.replace(/\n/g, "<br>");
          card.answer = storedText;
          card.originalAnswer = storedText;
          
          answerTextarea.focus();
        }
      };

      answerTextarea.addEventListener("change", () => {
        // 将实际换行符转换回<br>标签，保持数据一致性
        const storedAnswer = answerTextarea.value.replace(/\n/g, "<br>");
        this.cards[index].answer = storedAnswer;
        saveToHistory();
      });

      // 操作按钮区域 - 直接在answerEl中创建
      const actionsContainer = answerEl.createDiv();
      actionsContainer.style.marginTop = "10px";
      actionsContainer.style.display = "flex";
      actionsContainer.style.alignItems = "center";
      actionsContainer.style.gap = "15px";

      // 撤销按钮
      const undoButton = actionsContainer.createEl("button", {
        text: "撤销",
      });
      undoButton.style.padding = "4px 8px";
      undoButton.style.fontSize = "12px";
      undoButton.style.backgroundColor = "var(--background-modifier-border)";
      undoButton.style.color = "var(--text-normal)";
      undoButton.style.border = "1px solid var(--border-color)";
      undoButton.style.borderRadius = "4px";
      undoButton.style.cursor = "pointer";
      undoButton.addEventListener("click", (e) => {
        e.preventDefault();
        undo();
      });

      // 填空按钮（仅在Cloze类型时显示）
      const blankButton = actionsContainer.createEl("button", {
        text: "填空",
      });
      blankButton.style.padding = "4px 8px";
      blankButton.style.fontSize = "12px";
      blankButton.style.backgroundColor = "var(--interactive-accent)";
      blankButton.style.color = "var(--text-on-accent)";
      blankButton.style.border = "none";
      blankButton.style.borderRadius = "4px";
      blankButton.style.cursor = "pointer";

      // 颜色标签
      const colorLabel = actionsContainer.createEl("span", {
        text: "颜色: "
      });
      colorLabel.style.fontSize = "12px";
      colorLabel.style.marginLeft = "10px";

      // 颜色选项 - 使用按钮显示
      const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
      colors.forEach(color => {
        const colorOption = actionsContainer.createEl("button", {
          attr: {
            title: color
          }
        });
        colorOption.style.width = "20px";
        colorOption.style.height = "20px";
        colorOption.style.backgroundColor = color;
        colorOption.style.borderRadius = "50%";
        colorOption.style.cursor = "pointer";
        colorOption.style.border = "2px solid var(--border-color)";
        colorOption.style.marginLeft = "3px";
        colorOption.style.padding = "0";
        
        // 点击事件
        colorOption.addEventListener("click", (e) => {
          e.preventDefault();
          const start = answerTextarea.selectionStart;
          const end = answerTextarea.selectionEnd;
          const selectedText = answerTextarea.value.substring(start, end);
          
          if (selectedText) {
            // 保存当前状态到历史记录
            saveToHistory();
            
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
        });
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
          // 保存当前状态到历史记录
          saveToHistory();
          
          let text = answerTextarea.value;
          
          // 第一步：收集所有现有的填空，并按出现顺序重新编号
          const clozePattern = /\{\{c(\d+)::([^}]+)\}\}/g;
          const clozes: Array<{fullMatch: string, content: string, startIndex: number}> = [];
          let match;
          
          while ((match = clozePattern.exec(text)) !== null) {
            clozes.push({
              fullMatch: match[0],
              content: match[2],
              startIndex: match.index
            });
          }
          
          // 第二步：从后往前替换，避免索引变化问题
          // 先重新编号现有的填空
          for (let i = clozes.length - 1; i >= 0; i--) {
            const cloze = clozes[i];
            const newNumber = i + 1;
            const newCloze = `{{c${newNumber}::${cloze.content}}}`;
            
            // 计算替换位置（需要考虑之前的替换导致的偏移）
            let offset = 0;
            for (let j = clozes.length - 1; j > i; j--) {
              offset += (clozes[j].fullMatch.length - `{{c${j + 1}::${clozes[j].content}}}`.length);
            }
            
            const actualStartIndex = cloze.startIndex + offset;
            text = text.substring(0, actualStartIndex) + newCloze + text.substring(actualStartIndex + cloze.fullMatch.length);
          }
          
          // 第三步：计算新填空应该插入的位置（考虑重新编号后的文本变化）
          let newStart = start;
          let newEnd = end;
          
          // 计算由于重新编号导致的位置偏移
          for (const cloze of clozes) {
            if (cloze.startIndex < start) {
              const oldLength = cloze.fullMatch.length;
              const newNumber = clozes.indexOf(cloze) + 1;
              const newLength = `{{c${newNumber}::${cloze.content}}}`.length;
              newStart += (newLength - oldLength);
              newEnd += (newLength - oldLength);
            }
          }
          
          // 第四步：添加新的填空
          const newNumber = clozes.length + 1;
          const newText = text.substring(0, newStart) + `{{c${newNumber}::${selectedText}}}` + text.substring(newEnd);
          answerTextarea.value = newText;
          
          // 将实际换行符转换回<br>标签，保持数据一致性
          const storedText = newText.replace(/\n/g, "<br>");
          
          // 更新卡片数据
          card.answer = storedText;
          card.originalAnswer = storedText;
          
          // 重新聚焦并设置光标位置
          answerTextarea.focus();
          const newCursorPos = newStart + `{{c${newNumber}::${selectedText}}}`.length;
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
    
    // 设置header为flex布局，方便排列元素
    batchTagsHeader.style.display = "flex";
    batchTagsHeader.style.alignItems = "center";
    batchTagsHeader.style.justifyContent = "space-between";
    
    const batchTagsTitle = batchTagsHeader.createEl("h4", { text: "替换标签" });
    batchTagsTitle.style.margin = "0";
    batchTagsTitle.style.fontSize = "14px";
    batchTagsTitle.style.color = "var(--text-normal)";
    
    // 右侧折叠按钮
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
    batchTagsHeader.addEventListener("click", (e) => {
      // 防止点击checkbox时触发折叠
      if (!e.target.closest("input[type='checkbox']") && !e.target.closest("label")) {
        if (batchTagsContent.style.display === "none") {
          batchTagsContent.style.display = "block";
          batchTagsToggle.textContent = "▲";
        } else {
          batchTagsContent.style.display = "none";
          batchTagsToggle.textContent = "▼";
        }
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
    
    // 按钮和checkbox容器
    const buttonContainer = batchTagsContent.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.alignItems = "center";
    buttonContainer.style.gap = "15px";
    
    // 替换按钮
    const replaceButton = buttonContainer.createEl("button", {
      text: "替换标签",
    });
    replaceButton.style.padding = "8px 16px";
    replaceButton.style.backgroundColor = "var(--interactive-accent)";
    replaceButton.style.color = "var(--text-on-accent)";
    replaceButton.style.border = "none";
    replaceButton.style.borderRadius = "4px";
    replaceButton.style.cursor = "pointer";
    
    // 添加checkbox - 直接替换所有标签，放在按钮右边
    const replaceAllContainer = buttonContainer.createEl("div");
    replaceAllContainer.style.display = "flex";
    replaceAllContainer.style.alignItems = "center";
    
    const replaceAllCheckbox = replaceAllContainer.createEl("input", {
      type: "checkbox",
      attr: { id: "replaceAllTags" }
    });
    replaceAllCheckbox.style.marginRight = "5px";
    
    const replaceAllLabel = replaceAllContainer.createEl("label", {
      text: "直接替换所有标签",
      attr: { for: "replaceAllTags" }
    });
    replaceAllLabel.style.cursor = "pointer";
    replaceAllLabel.style.color = "var(--text-normal)";
    replaceAllLabel.style.fontSize = "12px";
    
    // 根据checkbox状态切换旧标签输入框的显示
    replaceAllCheckbox.addEventListener("change", () => {
      if (replaceAllCheckbox.checked) {
        oldTagInput.style.display = "none";
        newTagInput.placeholder = "输入新的标签（将替换所有卡片的标签）";
      } else {
        oldTagInput.style.display = "block";
        newTagInput.placeholder = "输入新的标签";
      }
    });
    
    // 替换标签功能
    replaceButton.addEventListener("click", () => {
      const newTag = newTagInput.value.trim();
      
      if (!newTag) {
        new Notice("请输入新的标签");
        return;
      }
      
      let replacedCount = 0;
      
      if (replaceAllCheckbox.checked) {
        // 直接替换所有卡片的标签
        this.cards.forEach(card => {
          card.tags = [newTag];
          replacedCount++;
        });
        
        new Notice(`已替换 ${replacedCount} 张卡片的标签`);
        // 直接更新标签显示，避免重新加载
        this.updateTagsDisplay();
      } else {
        // 替换特定标签
        const oldTag = oldTagInput.value.trim();
        
        if (!oldTag) {
          new Notice("请输入要替换的标签");
          return;
        }
        
        // 遍历所有卡片，替换标签
        this.cards.forEach(card => {
          if (card.tags && card.tags.includes(oldTag)) {
            card.tags = card.tags.map(tag => tag === oldTag ? newTag : tag);
            replacedCount++;
          }
        });
        
        if (replacedCount > 0) {
          new Notice(`已替换 ${replacedCount} 张卡片的标签`);
          // 直接更新标签显示，避免重新加载
          this.updateTagsDisplay();
        } else {
          new Notice("未找到要替换的标签");
        }
      }
    });

    // 操作按钮
    const mainButtonContainer = contentEl.createDiv({ cls: "ankify-button-container" });

    const addButton = mainButtonContainer.createEl("button", {
      text: "添加到Anki",
    });
    addButton.style.marginRight = "10px";
    addButton.style.padding = "8px 16px";
    addButton.style.backgroundColor = "var(--interactive-accent)";
    addButton.style.color = "var(--text-on-accent)";
    addButton.style.border = "none";
    addButton.style.borderRadius = "4px";
    addButton.style.cursor = "pointer";

    const cancelButton = mainButtonContainer.createEl("button", {
      text: "取消",
    });
    cancelButton.style.padding = "8px 16px";
    cancelButton.style.backgroundColor = "var(--background-modifier-border)";
    cancelButton.style.color = "var(--text-normal)";
    cancelButton.style.border = "1px solid var(--border-color)";
    cancelButton.style.borderRadius = "4px";
    cancelButton.style.cursor = "pointer";

    addButton.addEventListener("click", async () => {
      const selectedCards = this.cards.filter((_, index) => this.selectedCards[index]);

      if (selectedCards.length === 0) {
        new Notice("请至少选择一张卡片");
        return;
      }

      try {
        // 显示加载提示
        const loadingNotice = new Notice("正在添加卡片到Anki，请稍候...", 0);

        const results = await this.plugin.addNotesToAnki(
          selectedCards,
          this.deckSelect.value,
          this.noteTypeSelect.value
        );

        // 隐藏加载提示
        loadingNotice.hide();

        // 检查结果
        const successCount = results.filter((id) => id !== null).length;

        if (successCount > 0) {
          // 保存上次使用的牌组
          this.plugin.settings.lastUsedDeck = this.deckSelect.value;
          await this.plugin.saveSettings();
          
          new Notice(`成功添加 ${successCount} 张卡片到Anki`);
          this.close();
        } else {
          new Notice("添加卡片失败，请检查Anki是否正在运行");
        }
      } catch (error) {
        console.error("添加卡片失败:", error);
        new Notice(`添加卡片失败: ${error.message}`);
      }
    });

    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  // 更新卡片选择显示
  updateCardSelectionDisplay() {
    const checkboxes = this.contentEl.querySelectorAll(".ankify-card-checkbox input[type=checkbox]");
    checkboxes.forEach((checkbox, index) => {
      (checkbox as HTMLInputElement).checked = this.selectedCards[index];
    });
  }

  // 更新标签显示
  updateTagsDisplay() {
    const tagsInputs = this.contentEl.querySelectorAll(".ankify-card-tags input");
    tagsInputs.forEach((input, index) => {
      if (index < this.cards.length) {
        (input as HTMLInputElement).value = (this.cards[index].tags || []).join(" ");
      }
    });
  }

  // 添加请求信息面板
  addRequestInfo(contentEl: HTMLElement) {
    const requestInfoEl = contentEl.createDiv({ cls: "ankify-request-info" });
    requestInfoEl.style.marginTop = "20px";
    requestInfoEl.style.border = "1px solid var(--border-color)";
    requestInfoEl.style.borderRadius = "4px";
    requestInfoEl.style.backgroundColor = "var(--background-secondary)";
    requestInfoEl.style.overflow = "hidden";

    // 标题和切换按钮
    const headerEl = requestInfoEl.createEl("div");
    headerEl.style.display = "flex";
    headerEl.style.justifyContent = "space-between";
    headerEl.style.alignItems = "center";
    headerEl.style.padding = "10px";
    headerEl.style.cursor = "pointer";
    headerEl.style.backgroundColor = "var(--background-secondary)";

    headerEl.createEl("h4", { text: "请求信息" });
    const toggleEl = headerEl.createEl("span", { text: "▼" });

    // 内容区域（默认隐藏）
    const contentInfoEl = requestInfoEl.createDiv();
    contentInfoEl.style.padding = "10px";
    contentInfoEl.style.display = "none";

    // 切换显示/隐藏
    headerEl.addEventListener("click", () => {
      if (contentInfoEl.style.display === "none") {
        contentInfoEl.style.display = "block";
        toggleEl.textContent = "▲";
      } else {
        contentInfoEl.style.display = "none";
        toggleEl.textContent = "▼";
      }
    });

    // 显示提示词
    if (this.usedPrompt) {
      contentInfoEl.createEl("h5", { text: "提示词:" });
      const promptPre = contentInfoEl.createEl("pre");
      promptPre.style.backgroundColor = "var(--background-primary)";
      promptPre.style.padding = "10px";
      promptPre.style.borderRadius = "4px";
      promptPre.style.maxHeight = "200px";
      promptPre.style.overflow = "auto";
      promptPre.textContent = this.usedPrompt;
    }

    // 显示选中的内容
    if (this.selectedContent) {
      contentInfoEl.createEl("h5", { text: "选中内容:" });
      const contentPre = contentInfoEl.createEl("pre");
      contentPre.style.backgroundColor = "var(--background-primary)";
      contentPre.style.padding = "10px";
      contentPre.style.borderRadius = "4px";
      contentPre.style.maxHeight = "200px";
      contentPre.style.overflow = "auto";
      contentPre.textContent = this.selectedContent;
    }

    // 显示图片信息
    if (this.imageInfo) {
      contentInfoEl.createEl("h5", { text: "图片信息:" });
      const imageInfoPre = contentInfoEl.createEl("pre");
      imageInfoPre.style.backgroundColor = "var(--background-primary)";
      imageInfoPre.style.padding = "10px";
      imageInfoPre.style.borderRadius = "4px";
      imageInfoPre.style.maxHeight = "200px";
      imageInfoPre.style.overflow = "auto";
      imageInfoPre.textContent = this.imageInfo;
    }

    // 显示原始API结果
    if (this.rawResult) {
      contentInfoEl.createEl("h5", { text: "原始API结果:" });
      const resultPre = contentInfoEl.createEl("pre");
      resultPre.style.backgroundColor = "var(--background-primary)";
      resultPre.style.padding = "10px";
      resultPre.style.borderRadius = "4px";
      resultPre.style.maxHeight = "200px";
      resultPre.style.overflow = "auto";
      resultPre.textContent = this.rawResult;
    }
  }

  // 将结果追加到文档末尾
  appendResultToDocument(editor: Editor, result: string) {
    const docContent = editor.getValue();
    const newContent = docContent + "\n\n## Anki卡片\n\n" + result;
    editor.setValue(newContent);
    new Notice("Anki卡片已添加到文档末尾");
  }
}