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
  progressContainer: HTMLElement | null = null; // 进度提示窗
  private allowClose = false;

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

  // 拦截所有 close() 调用（包括点击背景、ESC），只有 forceClose() 才真正关闭
  close() {
    if (this.allowClose) {
      super.close();
    }
  }

  forceClose() {
    this.allowClose = true;
    super.close();
  }

  onOpen() {
    // 屏蔽点击背景关闭
    this.modalEl.setCssStyles({ position: "fixed" });
    this.modalEl.setCssStyles({ top: "50%" });
    this.modalEl.setCssStyles({ left: "50%" });
    this.modalEl.setCssStyles({ transform: "translate(-50%, -50%)" });
    this.modalEl.setCssStyles({ width: "80%" });
    this.modalEl.setCssStyles({ maxWidth: "800px" });
    this.modalEl.setCssStyles({ maxHeight: "80vh" });
    this.modalEl.setCssStyles({ overflow: "auto" });

    // 让右上角 X 按钮能正常关闭弹窗
    const closeBtn = this.modalEl.querySelector(".modal-close-button") as HTMLElement;
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.forceClose());
    }

    // 先显示调试信息和加载状态
    this.loadContent();
  }

  onClose() {
    // 关闭时清理进度提示窗
    if (this.progressContainer && document.body.contains(this.progressContainer)) {
      try {
        document.body.removeChild(this.progressContainer);
        this.progressContainer = null;
      } catch (e) {
        // 忽略移除错误
      }
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  async loadContent() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Anki卡片生成" });

    // 先添加请求信息面板（默认折叠）
    this.addRequestInfo(contentEl);

    // 创建加载区域
    const loadingContainer = contentEl.createDiv({ cls: "ankify-loading-container" });
    loadingContainer.setCssStyles({ textAlign: "center" });
    loadingContainer.setCssStyles({ padding: "20px" });

    const loadingSpinner = loadingContainer.createDiv({ cls: "ankify-loading-spinner" });
    loadingSpinner.setCssStyles({ fontSize: "24px" });
    loadingSpinner.setCssStyles({ marginBottom: "10px" });
    loadingSpinner.textContent = "⏳";

    const loadingText = loadingContainer.createDiv({ text: "正在生成Anki卡片，请稍候..." });
    loadingText.setCssStyles({ fontSize: "14px" });
    loadingText.setCssStyles({ color: "#666" });

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
          this.forceClose();
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
        }).setCssStyles({ color: "red" });
        
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
      textAreaEl.setCssStyles({ width: "100%" });
      textAreaEl.setCssStyles({ height: "100px" });

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
        this.forceClose();
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
      style: { display: "flex", alignItems: "center", gap: "5px" }
    });
    this.deckSelect = deckSelectContainer.createEl("select");

    // 向上按钮
    const upButton = deckSelectContainer.createEl("button", {
      text: "↑",
      attr: { type: "button" },
      style: { padding: "2px 6px", fontSize: "10px" }
    });

    upButton.addEventListener("click", () => {
      const currentIndex = this.deckSelect.selectedIndex;
      if (currentIndex > 0) {
        this.deckSelect.selectedIndex = currentIndex - 1;
        // 触发 change 事件
        const event = new Event('change');
        this.deckSelect.dispatchEvent(event);
      }
    });

    // 向下按钮
    const downButton = deckSelectContainer.createEl("button", {
      text: "↓",
      attr: { type: "button" },
      style: { padding: "2px 6px", fontSize: "10px" }
    });

    downButton.addEventListener("click", () => {
      const currentIndex = this.deckSelect.selectedIndex;
      if (currentIndex < this.deckSelect.options.length - 1) {
        this.deckSelect.selectedIndex = currentIndex + 1;
        // 触发 change 事件
        const event = new Event('change');
        this.deckSelect.dispatchEvent(event);
      }
    });

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

    addEventListener("click", () => { void (async () => {
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
        new Notice("刷新牌组失败，请确保Anki已启动且安装了Anki Connect插件");
      } finally {
        refreshDeckButton.disabled = false;
        refreshDeckButton.textContent = "刷新";
      }
        })(); });

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
    selectionCountEl.setCssStyles({ marginLeft: "10px" });
    selectionCountEl.setCssStyles({ color: "var(--text-muted)" });

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
      answerTextarea.setCssStyles({ width: "100%" });
      answerTextarea.setCssStyles({ minHeight: "100px" });
      answerTextarea.setCssStyles({ padding: "8px" });
      answerTextarea.setCssStyles({ border: "1px solid var(--border-color)" });
      answerTextarea.setCssStyles({ borderRadius: "4px" });
      answerTextarea.setCssStyles({ backgroundColor: "var(--background-primary)" });
      answerTextarea.setCssStyles({ color: "var(--text-normal)" });
      answerTextarea.setCssStyles({ fontFamily: "inherit" });
      answerTextarea.setCssStyles({ resize: "vertical" });
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
      actionsContainer.setCssStyles({ marginTop: "10px" });
      actionsContainer.setCssStyles({ display: "flex" });
      actionsContainer.setCssStyles({ alignItems: "center" });
      actionsContainer.setCssStyles({ gap: "15px" });

      // 撤销按钮
      const undoButton = actionsContainer.createEl("button", {
        text: "撤销",
      });
      undoButton.setCssStyles({ padding: "4px 8px" });
      undoButton.setCssStyles({ fontSize: "12px" });
      undoButton.setCssStyles({ backgroundColor: "var(--background-modifier-border)" });
      undoButton.setCssStyles({ color: "var(--text-normal)" });
      undoButton.setCssStyles({ border: "1px solid var(--border-color)" });
      undoButton.setCssStyles({ borderRadius: "4px" });
      undoButton.setCssStyles({ cursor: "pointer" });
      undoButton.addEventListener("click", (e) => {
        e.preventDefault();
        undo();
      });

      // 填空按钮（仅在Cloze类型时显示）
      const blankButton = actionsContainer.createEl("button", {
        text: "填空",
      });
      blankButton.setCssStyles({ padding: "4px 8px" });
      blankButton.setCssStyles({ fontSize: "12px" });
      blankButton.setCssStyles({ backgroundColor: "var(--interactive-accent)" });
      blankButton.setCssStyles({ color: "var(--text-on-accent)" });
      blankButton.setCssStyles({ border: "none" });
      blankButton.setCssStyles({ borderRadius: "4px" });
      blankButton.setCssStyles({ cursor: "pointer" });

      // 颜色标签
      const colorLabel = actionsContainer.createEl("span", {
        text: "颜色: "
      });
      colorLabel.setCssStyles({ fontSize: "12px" });
      colorLabel.setCssStyles({ marginLeft: "10px" });

      // 颜色选项 - 使用按钮显示
      const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9"];
      colors.forEach(color => {
        const colorOption = actionsContainer.createEl("button", {
          attr: {
            title: color
          }
        });
        colorOption.setCssStyles({ width: "20px" });
        colorOption.setCssStyles({ height: "20px" });
        colorOption.setCssStyles({ backgroundColor: color });
        colorOption.setCssStyles({ borderRadius: "50%" });
        colorOption.setCssStyles({ cursor: "pointer" });
        colorOption.setCssStyles({ border: "2px solid var(--border-color)" });
        colorOption.setCssStyles({ marginLeft: "3px" });
        colorOption.setCssStyles({ padding: "0" });
        
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
          blankButton.setCssStyles({ display: "inline-block" });
        } else {
          blankButton.setCssStyles({ display: "none" });
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
      noteTypeSelect.setCssStyles({ marginLeft: "5px" });

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
      backExtraContainer.setCssStyles({ marginTop: "10px" });
      
      // Back Extra 标题和折叠按钮
      const backExtraHeader = backExtraContainer.createDiv();
      backExtraHeader.setCssStyles({ display: "flex" });
      backExtraHeader.setCssStyles({ alignItems: "center" });
      backExtraHeader.setCssStyles({ cursor: "pointer" });
      backExtraHeader.setCssStyles({ padding: "5px 0" });
      
      const backExtraToggle = backExtraHeader.createSpan({ text: "▶" });
      backExtraToggle.setCssStyles({ marginRight: "5px" });
      backExtraToggle.setCssStyles({ color: "var(--text-muted)" });
      backExtraToggle.setCssStyles({ fontSize: "12px" });
      
      backExtraHeader.createEl("strong", { text: "Back Extra" });
      
      // Back Extra 内容区域（默认隐藏）
      const backExtraContent = backExtraContainer.createDiv({ cls: "ankify-card-back-extra" });
      backExtraContent.setCssStyles({ display: "none" });
      backExtraContent.setCssStyles({ marginTop: "5px" });
      
      const backExtraTextarea = backExtraContent.createEl("textarea", {
        cls: "ankify-card-textarea",
        text: card.backExtra || "",
      });
      backExtraTextarea.setCssStyles({ width: "100%" });
      backExtraTextarea.setCssStyles({ minHeight: "60px" });
      backExtraTextarea.setCssStyles({ padding: "8px" });
      backExtraTextarea.setCssStyles({ border: "1px solid var(--border-color)" });
      backExtraTextarea.setCssStyles({ borderRadius: "4px" });
      backExtraTextarea.setCssStyles({ backgroundColor: "var(--background-primary)" });
      backExtraTextarea.setCssStyles({ color: "var(--text-normal)" });
      backExtraTextarea.setCssStyles({ fontFamily: "inherit" });
      backExtraTextarea.setCssStyles({ resize: "vertical" });
      backExtraTextarea.addEventListener("input", () => {
        // 将实际换行符转换回<br>标签，保持数据一致性
        const storedBackExtra = backExtraTextarea.value.replace(/\n/g, "<br>");
        this.cards[index].backExtra = storedBackExtra;
      });
      
      // 切换折叠状态
      backExtraHeader.addEventListener("click", () => {
        if (backExtraContent.style.display === "none") {
          backExtraContent.setCssStyles({ display: "block" });
          backExtraToggle.textContent = "▼";
        } else {
          backExtraContent.setCssStyles({ display: "none" });
          backExtraToggle.textContent = "▶";
        }
      });
      
      // 控制Back Extra容器显示状态
      const updateBackExtraVisibility = () => {
        if (card.noteType === "Cloze") {
          backExtraContainer.setCssStyles({ display: "block" });
        } else {
          backExtraContainer.setCssStyles({ display: "none" });
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
    batchTagsContainer.setCssStyles({ marginTop: "20px" });
    
    // 标题和折叠按钮
    const batchTagsHeader = batchTagsContainer.createDiv();
    batchTagsHeader.setCssStyles({ display: "flex" });
    batchTagsHeader.setCssStyles({ justifyContent: "space-between" });
    batchTagsHeader.setCssStyles({ alignItems: "center" });
    batchTagsHeader.setCssStyles({ cursor: "pointer" });
    batchTagsHeader.setCssStyles({ padding: "10px" });
    batchTagsHeader.setCssStyles({ backgroundColor: "var(--background-secondary)" });
    batchTagsHeader.setCssStyles({ border: "1px solid var(--border-color)" });
    batchTagsHeader.setCssStyles({ borderRadius: "4px" });
    batchTagsHeader.setCssStyles({ color: "var(--text-normal)" });
    
    // 设置header为flex布局，方便排列元素
    batchTagsHeader.setCssStyles({ display: "flex" });
    batchTagsHeader.setCssStyles({ alignItems: "center" });
    batchTagsHeader.setCssStyles({ justifyContent: "space-between" });
    
    const batchTagsTitle = batchTagsHeader.createEl("h4", { text: "替换标签" });
    batchTagsTitle.setCssStyles({ margin: "0" });
    batchTagsTitle.setCssStyles({ fontSize: "14px" });
    batchTagsTitle.setCssStyles({ color: "var(--text-normal)" });
    
    // 右侧折叠按钮
    const batchTagsToggle = batchTagsHeader.createSpan({ text: "▼" });
    batchTagsToggle.setCssStyles({ color: "var(--text-muted)" });
    
    // 内容区域，默认隐藏
    const batchTagsContent = batchTagsContainer.createDiv();
    batchTagsContent.setCssStyles({ display: "none" });
    batchTagsContent.setCssStyles({ padding: "15px" });
    batchTagsContent.setCssStyles({ backgroundColor: "var(--background-secondary)" });
    batchTagsContent.setCssStyles({ border: "1px solid var(--border-color)" });
    batchTagsContent.setCssStyles({ borderTop: "none" });
    batchTagsContent.setCssStyles({ borderRadius: "0 0 4px 4px" });
    batchTagsContent.setCssStyles({ color: "var(--text-normal)" });
    
    // 切换折叠状态
    batchTagsHeader.addEventListener("click", (e) => {
      // 防止点击checkbox时触发折叠
      if (!e.target.closest("input[type='checkbox']") && !e.target.closest("label")) {
        if (batchTagsContent.style.display === "none") {
          batchTagsContent.setCssStyles({ display: "block" });
          batchTagsToggle.textContent = "▲";
        } else {
          batchTagsContent.setCssStyles({ display: "none" });
          batchTagsToggle.textContent = "▼";
        }
      }
    });
    
    // 旧标签输入框
    const oldTagInput = batchTagsContent.createEl("input", {
      type: "text",
      placeholder: "输入要替换的标签",
    });
    oldTagInput.setCssStyles({ width: "100%" });
    oldTagInput.setCssStyles({ padding: "8px" });
    oldTagInput.setCssStyles({ marginBottom: "10px" });
    oldTagInput.setCssStyles({ border: "1px solid var(--border-color)" });
    oldTagInput.setCssStyles({ borderRadius: "4px" });
    oldTagInput.setCssStyles({ backgroundColor: "var(--background-primary)" });
    oldTagInput.setCssStyles({ color: "var(--text-normal)" });
    
    // 新标签输入框
    const newTagInput = batchTagsContent.createEl("input", {
      type: "text",
      placeholder: "输入新的标签",
    });
    newTagInput.setCssStyles({ width: "100%" });
    newTagInput.setCssStyles({ padding: "8px" });
    newTagInput.setCssStyles({ marginBottom: "10px" });
    newTagInput.setCssStyles({ border: "1px solid var(--border-color)" });
    newTagInput.setCssStyles({ borderRadius: "4px" });
    newTagInput.setCssStyles({ backgroundColor: "var(--background-primary)" });
    newTagInput.setCssStyles({ color: "var(--text-normal)" });
    
    // 按钮和checkbox容器
    const buttonContainer = batchTagsContent.createDiv();
    buttonContainer.setCssStyles({ display: "flex" });
    buttonContainer.setCssStyles({ alignItems: "center" });
    buttonContainer.setCssStyles({ gap: "15px" });
    
    // 替换按钮
    const replaceButton = buttonContainer.createEl("button", {
      text: "替换标签",
    });
    replaceButton.setCssStyles({ padding: "8px 16px" });
    replaceButton.setCssStyles({ backgroundColor: "var(--interactive-accent)" });
    replaceButton.setCssStyles({ color: "var(--text-on-accent)" });
    replaceButton.setCssStyles({ border: "none" });
    replaceButton.setCssStyles({ borderRadius: "4px" });
    replaceButton.setCssStyles({ cursor: "pointer" });
    
    // 添加checkbox - 直接替换所有标签，放在按钮右边
    const replaceAllContainer = buttonContainer.createDiv();
    replaceAllContainer.setCssStyles({ display: "flex" });
    replaceAllContainer.setCssStyles({ alignItems: "center" });
    
    const replaceAllCheckbox = replaceAllContainer.createEl("input", {
      type: "checkbox",
      attr: { id: "replaceAllTags" }
    });
    replaceAllCheckbox.setCssStyles({ marginRight: "5px" });
    
    const replaceAllLabel = replaceAllContainer.createEl("label", {
      text: "直接替换所有标签",
      attr: { for: "replaceAllTags" }
    });
    replaceAllLabel.setCssStyles({ cursor: "pointer" });
    replaceAllLabel.setCssStyles({ color: "var(--text-normal)" });
    replaceAllLabel.setCssStyles({ fontSize: "12px" });
    
    // 根据checkbox状态切换旧标签输入框的显示
    replaceAllCheckbox.addEventListener("change", () => {
      if (replaceAllCheckbox.checked) {
        oldTagInput.setCssStyles({ display: "none" });
        newTagInput.placeholder = "输入新的标签（将替换所有卡片的标签）";
      } else {
        oldTagInput.setCssStyles({ display: "block" });
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
    addButton.setCssStyles({ marginRight: "10px" });
    addButton.setCssStyles({ padding: "8px 16px" });
    addButton.setCssStyles({ backgroundColor: "var(--interactive-accent)" });
    addButton.setCssStyles({ color: "var(--text-on-accent)" });
    addButton.setCssStyles({ border: "none" });
    addButton.setCssStyles({ borderRadius: "4px" });
    addButton.setCssStyles({ cursor: "pointer" });

    const cancelButton = mainButtonContainer.createEl("button", {
      text: "取消",
    });
    cancelButton.setCssStyles({ padding: "8px 16px" });
    cancelButton.setCssStyles({ backgroundColor: "var(--background-modifier-border)" });
    cancelButton.setCssStyles({ color: "var(--text-normal)" });
    cancelButton.setCssStyles({ border: "1px solid var(--border-color)" });
    cancelButton.setCssStyles({ borderRadius: "4px" });
    cancelButton.setCssStyles({ cursor: "pointer" });

    addEventListener("click", () => { void (async () => {
      const selectedCards = this.cards.filter((_, index) => this.selectedCards[index]);

      if (selectedCards.length === 0) {
        new Notice("请至少选择一张卡片");
        return;
      }

      try {
        // 创建进度条容器
        this.progressContainer = document.body.createDiv();
        this.progressContainer.setCssStyles({ position: "fixed" });
        this.progressContainer.setCssStyles({ top: "50%" });
        this.progressContainer.setCssStyles({ left: "50%" });
        this.progressContainer.setCssStyles({ transform: "translate(-50%, -50%)" });
        this.progressContainer.setCssStyles({ backgroundColor: "var(--background-primary)" });
        this.progressContainer.setCssStyles({ border: "1px solid var(--border-color)" });
        this.progressContainer.setCssStyles({ borderRadius: "8px" });
        this.progressContainer.setCssStyles({ padding: "20px" });
        this.progressContainer.setCssStyles({ minWidth: "300px" });
        this.progressContainer.setCssStyles({ zIndex: "9999" });
        
        // 标题
        const progressTitle = this.progressContainer.createDiv();
        progressTitle.setCssStyles({ fontSize: "14px" });
        progressTitle.setCssStyles({ fontWeight: "bold" });
        progressTitle.setCssStyles({ marginBottom: "10px" });
        progressTitle.setCssStyles({ textAlign: "center" });
        progressTitle.textContent = "正在添加卡片到Anki...";
        this.progressContainer.appendChild(progressTitle);
        
        // 批次大小信息（仅在调试模式下显示）
        if (this.plugin.settings.debugMode) {
          const batchInfo = this.progressContainer.createDiv();
          batchInfo.setCssStyles({ fontSize: "12px" });
          batchInfo.setCssStyles({ color: "var(--text-muted)" });
          batchInfo.setCssStyles({ marginBottom: "10px" });
          batchInfo.setCssStyles({ textAlign: "center" });
          batchInfo.textContent = `批次大小: ${this.plugin.settings.batchSize}`;
          this.progressContainer.appendChild(batchInfo);
        }
        
        // 进度文本
        const progressText = this.progressContainer.createDiv();
        progressText.setCssStyles({ fontSize: "12px" });
        progressText.setCssStyles({ marginBottom: "10px" });
        progressText.setCssStyles({ textAlign: "center" });
        progressText.textContent = "0 / 0";
        this.progressContainer.appendChild(progressText);
        
        // 进度条
        const progressBar = this.progressContainer.createDiv();
        progressBar.setCssStyles({ height: "6px" });
        progressBar.setCssStyles({ backgroundColor: "var(--background-secondary)" });
        progressBar.setCssStyles({ borderRadius: "3px" });
        progressBar.setCssStyles({ overflow: "hidden" });
        
        const progressFill = progressBar.createDiv();
        progressFill.setCssStyles({ height: "100%" });
        progressFill.setCssStyles({ backgroundColor: "var(--interactive-accent)" });
        progressFill.setCssStyles({ width: "0%" });
        progressFill.setCssStyles({ transition: "width 0.3s ease" });
        progressBar.appendChild(progressFill);
        this.progressContainer.appendChild(progressBar);
        
        // 添加到文档
        document.body.appendChild(this.progressContainer);

        const results = await this.plugin.addNotesToAnki(
          selectedCards,
          this.deckSelect.value,
          this.noteTypeSelect.value,
          (current, total) => {
            // 更新进度
            const percentage = (current / total) * 100;
            progressFill.setCssStyles({ width: `${percentage}%` });
            progressText.textContent = `${current} / ${total}`;
          }
        );

        // 移除进度条
        if (this.progressContainer && document.body.contains(this.progressContainer)) {
          document.body.removeChild(this.progressContainer);
          this.progressContainer = null;
        }

        // 检查结果
        const successCount = results.filter((id) => id !== null).length;

        if (successCount > 0) {
          // 保存上次使用的牌组
          this.plugin.settings.lastUsedDeck = this.deckSelect.value;
          await this.plugin.saveSettings();
          
          new Notice(`成功添加 ${successCount} 张卡片到Anki`);
          this.forceClose();
        } else {
          new Notice("添加卡片失败，请检查Anki是否正在运行");
        }
      } catch (error) {
        // 移除进度条
        if (this.progressContainer && document.body.contains(this.progressContainer)) {
          try {
            document.body.removeChild(this.progressContainer);
            this.progressContainer = null;
          } catch (e) {
            // 忽略移除错误
          }
        }
        new Notice(`添加卡片失败: ${error.message}`);
      }
        })(); });

    cancelButton.addEventListener("click", () => {
      this.forceClose();
    });
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
    requestInfoEl.setCssStyles({ marginTop: "20px" });
    requestInfoEl.setCssStyles({ border: "1px solid var(--border-color)" });
    requestInfoEl.setCssStyles({ borderRadius: "4px" });
    requestInfoEl.setCssStyles({ backgroundColor: "var(--background-secondary)" });
    requestInfoEl.setCssStyles({ overflow: "hidden" });

    // 标题和切换按钮
    const headerEl = requestInfoEl.createDiv();
    headerEl.setCssStyles({ display: "flex" });
    headerEl.setCssStyles({ justifyContent: "space-between" });
    headerEl.setCssStyles({ alignItems: "center" });
    headerEl.setCssStyles({ padding: "10px" });
    headerEl.setCssStyles({ cursor: "pointer" });
    headerEl.setCssStyles({ backgroundColor: "var(--background-secondary)" });

    headerEl.createEl("h4", { text: "请求信息" });
    const toggleEl = headerEl.createSpan({ text: "▼" });

    // 内容区域（默认隐藏）
    const contentInfoEl = requestInfoEl.createDiv();
    contentInfoEl.setCssStyles({ padding: "10px" });
    contentInfoEl.setCssStyles({ display: "none" });

    // 切换显示/隐藏
    headerEl.addEventListener("click", () => {
      if (contentInfoEl.style.display === "none") {
        contentInfoEl.setCssStyles({ display: "block" });
        toggleEl.textContent = "▲";
      } else {
        contentInfoEl.setCssStyles({ display: "none" });
        toggleEl.textContent = "▼";
      }
    });

    // 显示提示词
    if (this.usedPrompt) {
      contentInfoEl.createEl("h5", { text: "提示词:" });
      const promptPre = contentInfoEl.createEl("pre");
      promptPre.setCssStyles({ backgroundColor: "var(--background-primary)" });
      promptPre.setCssStyles({ padding: "10px" });
      promptPre.setCssStyles({ borderRadius: "4px" });
      promptPre.setCssStyles({ maxHeight: "200px" });
      promptPre.setCssStyles({ overflow: "auto" });
      promptPre.textContent = this.usedPrompt;
    }

    // 显示选中的内容
    if (this.selectedContent) {
      contentInfoEl.createEl("h5", { text: "选中内容:" });
      const contentPre = contentInfoEl.createEl("pre");
      contentPre.setCssStyles({ backgroundColor: "var(--background-primary)" });
      contentPre.setCssStyles({ padding: "10px" });
      contentPre.setCssStyles({ borderRadius: "4px" });
      contentPre.setCssStyles({ maxHeight: "200px" });
      contentPre.setCssStyles({ overflow: "auto" });
      contentPre.textContent = this.selectedContent;
    }

    // 显示图片信息
    if (this.imageInfo) {
      contentInfoEl.createEl("h5", { text: "图片信息:" });
      const imageInfoPre = contentInfoEl.createEl("pre");
      imageInfoPre.setCssStyles({ backgroundColor: "var(--background-primary)" });
      imageInfoPre.setCssStyles({ padding: "10px" });
      imageInfoPre.setCssStyles({ borderRadius: "4px" });
      imageInfoPre.setCssStyles({ maxHeight: "200px" });
      imageInfoPre.setCssStyles({ overflow: "auto" });
      imageInfoPre.textContent = this.imageInfo;
    }

    // 显示原始API结果
    if (this.rawResult) {
      contentInfoEl.createEl("h5", { text: "原始API结果:" });
      const resultPre = contentInfoEl.createEl("pre");
      resultPre.setCssStyles({ backgroundColor: "var(--background-primary)" });
      resultPre.setCssStyles({ padding: "10px" });
      resultPre.setCssStyles({ borderRadius: "4px" });
      resultPre.setCssStyles({ maxHeight: "200px" });
      resultPre.setCssStyles({ overflow: "auto" });
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