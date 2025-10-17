import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";

let pluginName: string;
let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * 数据缓存管理类
 * 用于缓存块属性数据，减少重复的后端调用
 */
class DataCache {
  private blockPropertiesCache = new Map<number, {
    colorValue: string | null;
    iconValue: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
    timestamp: number;
  }>();
  
  private readonly CACHE_TTL = 30000; // 缓存30秒
  
  /**
   * 获取缓存的块属性
   */
  getBlockProperties(blockId: number): {
    colorValue: string | null;
    iconValue: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
  } | null {
    const cached = this.blockPropertiesCache.get(blockId);
    if (!cached) return null;
    
    // 检查缓存是否过期
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.blockPropertiesCache.delete(blockId);
      return null;
    }
    
    return {
      colorValue: cached.colorValue,
      iconValue: cached.iconValue,
      colorEnabled: cached.colorEnabled,
      iconEnabled: cached.iconEnabled
    };
  }
  
  /**
   * 设置缓存的块属性
   */
  setBlockProperties(blockId: number, properties: {
    colorValue: string | null;
    iconValue: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
  }): void {
    this.blockPropertiesCache.set(blockId, {
      ...properties,
      timestamp: Date.now()
    });
  }
  
  /**
   * 清除指定块的缓存
   */
  clearBlockCache(blockId: number): void {
    this.blockPropertiesCache.delete(blockId);
  }
  
  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.blockPropertiesCache.clear();
  }
  
  /**
   * 清理过期的缓存
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [blockId, cached] of this.blockPropertiesCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        this.blockPropertiesCache.delete(blockId);
      }
    }
  }
}

/**
 * DOM查询缓存管理类
 * 用于缓存DOM元素引用，避免重复查询
 */
class DOMCache {
  private panelElementsCache = new Map<string, Element | null>();
  private containerElementsCache = new Map<string, NodeListOf<Element>>();
  private lastPanelStructureHash = '';
  
  /**
   * 获取面板元素（带缓存）
   */
  getPanelElement(panelId: string): Element | null {
    if (this.panelElementsCache.has(panelId)) {
      return this.panelElementsCache.get(panelId)!;
    }
    
    const element = document.querySelector(`[data-panel-id="${panelId}"]`);
    this.panelElementsCache.set(panelId, element);
    return element;
  }
  
  /**
   * 获取面板内的容器块元素（带缓存）
   */
  getContainerElements(panelId: string): NodeListOf<Element> {
    const cacheKey = `${panelId}_containers`;
    
    if (this.containerElementsCache.has(cacheKey)) {
      return this.containerElementsCache.get(cacheKey)!;
    }
    
    const panelElement = this.getPanelElement(panelId);
    if (!panelElement) {
      const emptyList = document.querySelectorAll('.orca-block.orca-container');
      this.containerElementsCache.set(cacheKey, emptyList);
      return emptyList;
    }
    
    const elements = panelElement.querySelectorAll('.orca-block.orca-container');
    this.containerElementsCache.set(cacheKey, elements);
    return elements;
  }
  
  /**
   * 清除指定面板的缓存
   */
  clearPanelCache(panelId: string): void {
    this.panelElementsCache.delete(panelId);
    this.containerElementsCache.delete(`${panelId}_containers`);
  }
  
  /**
   * 清除所有DOM缓存
   */
  clearAllCache(): void {
    this.panelElementsCache.clear();
    this.containerElementsCache.clear();
    this.lastPanelStructureHash = '';
  }
  
  /**
   * 检查面板结构是否发生变化
   */
  checkPanelStructureChange(): boolean {
    const currentHash = this.generatePanelStructureHash();
    if (currentHash !== this.lastPanelStructureHash) {
      this.lastPanelStructureHash = currentHash;
      return true;
    }
    return false;
  }
  
  /**
   * 生成面板结构哈希值
   */
  private generatePanelStructureHash(): string {
    const panels = orca.state.panels;
    const viewPanels = collectViewPanels(panels);
    return viewPanels.map(p => `${p.id}-${p.view}-${p.viewArgs?.blockId || p.viewArgs?.date || ''}`).join('|');
  }
}

/**
 * 统一MutationObserver管理类
 * 使用单一观察器替代多个独立观察器，提升性能和稳定性
 */
class UnifiedObserverManager {
  private observer: MutationObserver | null = null;
  private observedElements = new Map<Element, {
    displayColor: string;
    bgColorValue: string;
    iconValue: string | null;
  }>();
  
  /**
   * 启动统一观察器
   */
  startObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new MutationObserver((mutations) => {
      // 批量处理所有变化，避免频繁重绘
      const elementsToUpdate = new Set<Element>();
      
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as Element;
          const containerBlock = target.closest('.orca-block.orca-container');
          if (containerBlock && this.observedElements.has(containerBlock)) {
            elementsToUpdate.add(containerBlock);
          }
        } else if (mutation.type === 'childList') {
          // 检查新增的子元素
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              const containerBlock = element.closest('.orca-block.orca-container');
              if (containerBlock && this.observedElements.has(containerBlock)) {
                elementsToUpdate.add(containerBlock);
              }
            }
          });
        }
      });
      
      // 批量更新所有需要更新的元素
      elementsToUpdate.forEach(element => {
        const config = this.observedElements.get(element);
        if (config) {
          applyBlockHandleColor(element, config.displayColor, config.bgColorValue, config.iconValue);
        }
      });
    });
    
    // 开始观察整个文档
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
      childList: true
    });
  }
  
  /**
   * 添加要观察的元素
   */
  addObservedElement(element: Element, displayColor: string, bgColorValue: string, iconValue: string | null): void {
    this.observedElements.set(element, {
      displayColor,
      bgColorValue,
      iconValue
    });
  }
  
  /**
   * 移除观察的元素
   */
  removeObservedElement(element: Element): void {
    this.observedElements.delete(element);
  }
  
  /**
   * 停止观察器
   */
  stopObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.observedElements.clear();
  }
  
  /**
   * 清理所有观察的元素
   */
  clearAllObservedElements(): void {
    this.observedElements.clear();
  }
}

// 创建全局缓存实例
const dataCache = new DataCache();
const domCache = new DOMCache();
const unifiedObserver = new UnifiedObserverManager();

// 初始化重试相关变量
let retryCount: number = 0;
const MAX_RETRY_COUNT = 3; // 最大重试次数
const RETRY_DELAY = 500; // 重试延迟（毫秒）
const INITIAL_DELAY = 500; // 初始延迟（毫秒）

// 定义设置 schema
const settingsSchema = {
  useDomColor: {
    label: "使用 DOM 颜色",
    type: "boolean" as const,
    defaultValue: false,
  },
  debugMode: {
    label: "调试模式",
    type: "boolean" as const,
    defaultValue: false,
  },
};

/**
 * 调试日志辅助函数
 */
function debugLog(...args: any[]) {
  const settings = orca.state.plugins[pluginName]?.settings;
  if (settings?.debugMode) {
    console.log('[Tana Tag Color Plugin]', ...args);
  }
}

/**
 * 调试错误日志辅助函数
 */
function debugError(...args: any[]) {
  const settings = orca.state.plugins[pluginName]?.settings;
  if (settings?.debugMode) {
    console.error('[Tana Tag Color Plugin]', ...args);
  }
}

/**
 * 递归遍历面板结构，收集所有 ViewPanel（优化算法）
 */
function collectViewPanels(panel: any): any[] {
  const viewPanels: any[] = [];
  
  if (!panel) return viewPanels;
  
  // 使用迭代替代递归，避免栈溢出
  const stack = [panel];
  
  while (stack.length > 0) {
    const currentPanel = stack.pop();
    
    if (!currentPanel) continue;
    
    // 如果是 ViewPanel（有 view 属性）
    if (currentPanel.view) {
      viewPanels.push(currentPanel);
    }
    
    // 如果有 children，添加到栈中
    if (currentPanel.children && Array.isArray(currentPanel.children)) {
      // 使用展开运算符批量添加，避免逐个push
      stack.push(...currentPanel.children);
    }
  }
  
  return viewPanels;
}

/**
 * 防抖执行函数（优化异步处理和响应速度）
 */
function debounceGetPanelBlockIds() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    // 使用 requestAnimationFrame 优化渲染，避免闪烁
    requestAnimationFrame(async () => {
      try {
        // 检查面板结构是否发生变化，如果变化则清除缓存
        if (domCache.checkPanelStructureChange()) {
          domCache.clearAllCache();
          dataCache.clearAllCache();
        }
        
        await getAllPanelBlockIds();
      } catch (error) {
        debugError('执行getAllPanelBlockIds时发生错误:', error);
        // 清理缓存，避免错误状态持续
        dataCache.clearAllCache();
        domCache.clearAllCache();
      }
    });
  }, 50); // 降低防抖延迟到50ms，提升响应速度
}

/**
 * 获取所有面板的块ID（优化异步处理）
 */
async function getAllPanelBlockIds() {
  const panels = orca.state.panels;
  const viewPanels = collectViewPanels(panels);
  const blockIds: number[] = [];
  
  // 优化：并行处理所有面板的块ID获取
  const panelPromises = viewPanels.map(async (panel) => {
    try {
      if (panel.view === "block") {
        // block 类型面板，直接获取 blockId
        const blockId = panel.viewArgs?.blockId;
        if (blockId != null) {
          return blockId;
        }
      } else if (panel.view === "journal") {
        // journal 类型面板，通过日期获取 journal block
        const date = panel.viewArgs?.date;
        if (date) {
          const journalBlock = await orca.invokeBackend("get-journal-block", new Date(date));
          if (journalBlock?.id != null) {
            return journalBlock.id;
          }
        }
      }
    } catch (error) {
      debugError(`获取面板块ID失败:`, error);
    }
    return null;
  });
  
  // 等待所有面板处理完成
  const results = await Promise.all(panelPromises);
  
  // 过滤掉null值并添加到blockIds数组
  results.forEach(blockId => {
    if (blockId !== null) {
      blockIds.push(blockId);
    }
  });
  
  debugLog("所有面板的块ID:", blockIds);

  // 读取所有面板的容器块元素
  await readAllPanelsContainerBlocks(viewPanels);
  
  return blockIds;
}

/**
 * 检查DOM是否准备好（使用DOM缓存优化）
 * @returns 是否有至少一个面板的DOM元素存在
 */
function isDOMReady(): boolean {
  const panels = orca.state.panels;
  const viewPanels = collectViewPanels(panels);
  
  // 检查是否至少有一个面板的DOM元素存在
  for (const panel of viewPanels) {
    const panelElement = domCache.getPanelElement(panel.id);
    if (panelElement) {
      return true;
    }
  }
  
  return false;
}

/**
 * 带重试的初始化函数
 */
async function initializeWithRetry() {
  debugLog(`初始化尝试 ${retryCount + 1}/${MAX_RETRY_COUNT + 1}`);
  
  // 检查DOM是否准备好
  if (isDOMReady()) {
    debugLog("DOM已准备好，开始应用颜色");
    retryCount = 0; // 重置重试计数
    await getAllPanelBlockIds();
  } else {
    // DOM未准备好，检查是否需要重试
    if (retryCount < MAX_RETRY_COUNT) {
      retryCount++;
      debugLog(`DOM未准备好，将在 ${RETRY_DELAY}ms 后重试`);
      setTimeout(() => initializeWithRetry(), RETRY_DELAY);
    } else {
      debugError(`DOM未准备好，已达到最大重试次数 (${MAX_RETRY_COUNT})`);
      retryCount = 0; // 重置重试计数
    }
  }
}

/**
 * 检测当前是否为暗色模式
 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark') || 
         window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 根据colorValue计算domColor
 * 使用公式: oklch(from colorValue calc(1.3 * l) c h)
 */
function calculateDomColor(colorValue: string): string {
  return `oklch(from ${colorValue} calc(1.3 * l) c h)`;
}

/**
 * 将十六进制颜色转换为带透明度的 rgba 格式
 */
function hexToRgba(hex: string, alpha: number): string {
  // 移除 # 符号
  hex = hex.replace('#', '');
  
  // 处理简写格式 (如 #fff)
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 为容器块的无序点应用颜色样式和图标
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 */
function applyBlockHandleColor(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null) {
  // 查找当前块的所有图标元素和标题元素
  const handleElements = blockElement.querySelectorAll('.orca-block-handle');
  const titleElements = blockElement.querySelectorAll('.orca-repr-title');
  
  // 获取当前块的data-id
  const currentBlockId = blockElement.getAttribute('data-id');
  
  // 处理图标元素
  handleElements.forEach(handleElement => {
    // 检查这个图标是否属于当前块（不是子块）
    const handleParentBlock = handleElement.closest('.orca-block.orca-container');
    if (handleParentBlock && handleParentBlock.getAttribute('data-id') !== currentBlockId) {
      return; // 跳过子块的图标
    }
    if (handleElement instanceof HTMLElement) {
      // 设置前景颜色（可能是 domColor 或 colorValue）
      handleElement.style.setProperty('color', displayColor, 'important');
      
      // 设置图标属性
      if (iconValue) {
        handleElement.setAttribute('data-icon', iconValue);
        debugLog(`为块 ${currentBlockId} 的图标设置 data-icon="${iconValue}"`);
      } else {
        debugLog(`块 ${currentBlockId} 没有图标值，跳过设置 data-icon`);
      }
      // 注意：不在这里移除 data-icon，避免清理自身块设置的图标
      
      // 如果有 orca-block-handle-collapsed 类，设置背景颜色（始终使用 colorValue，透明度 0.45）
      if (handleElement.classList.contains('orca-block-handle-collapsed')) {
        const bgColor = hexToRgba(bgColorValue, 0.45);
        handleElement.style.setProperty('background-color', bgColor, 'important');
      } else {
        // 没有折叠类时，清除背景颜色
        handleElement.style.removeProperty('background-color');
        // 确保非折叠状态下完全不透明
        handleElement.style.setProperty('opacity', '1', 'important');
      }
    }
  });
  
  // 处理标题元素
  titleElements.forEach(titleElement => {
    // 检查这个标题是否属于当前块（不是子块）
    const titleParentBlock = titleElement.closest('.orca-block.orca-container');
    if (titleParentBlock && titleParentBlock.getAttribute('data-id') !== currentBlockId) {
      return; // 跳过子块的标题
    }
    if (titleElement instanceof HTMLElement) {
      // 只设置前景颜色（标题不需要图标和背景色）
      titleElement.style.setProperty('color', displayColor, 'important');
    }
  });
}

/**
 * 为内联引用应用颜色样式
 * @param inlineElement 内联引用元素
 * @param displayColor 显示颜色（用于 color 属性）
 */
function applyInlineRefColor(inlineElement: Element, displayColor: string) {
  // 查找 .orca-inline-r-content 元素
  const contentElement = inlineElement.querySelector('.orca-inline-r-content');
  
  if (contentElement instanceof HTMLElement) {
    // 设置内容颜色
    contentElement.style.setProperty('color', displayColor, 'important');
  }
}

/**
 * 监听块的折叠/展开状态变化（使用统一观察器优化）
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 */
function observeBlockHandleCollapse(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null) {
  // 使用统一观察器管理
  unifiedObserver.addObservedElement(blockElement, displayColor, bgColorValue, iconValue);
}

/**
 * 获取块的 _color 和 _icon 属性值（使用缓存优化）
 * @returns { colorValue: string | null, iconValue: string | null, colorEnabled: boolean, iconEnabled: boolean }
 */
async function getBlockStyleProperties(blockId: number): Promise<{ colorValue: string | null; iconValue: string | null; colorEnabled: boolean; iconEnabled: boolean }> {
  // 先尝试从缓存获取
  const cached = dataCache.getBlockProperties(blockId);
  if (cached) {
    debugLog(`从缓存获取块 ${blockId} 的属性:`, cached);
    return cached;
  }
  
  try {
    const block = await orca.invokeBackend("get-block", blockId);
    
    if (!block || !block.properties || !Array.isArray(block.properties)) {
      const result = { colorValue: null, iconValue: null, colorEnabled: false, iconEnabled: false };
      dataCache.setBlockProperties(blockId, result);
      return result;
    }
    
    // 查找 name="_color" 的属性
    const colorProperty = block.properties.find(
      (prop: any) => prop.name === "_color"
    );
    
    // 查找 name="_icon" 的属性
    const iconProperty = block.properties.find(
      (prop: any) => prop.name === "_icon"
    );
    
    // 调试：显示所有属性信息
    debugLog(`块 ${blockId} 的属性信息:`, {
      所有属性: block.properties.map((prop: any) => ({
        name: prop.name,
        type: prop.type,
        value: prop.value
      })),
      _color属性: colorProperty,
      _icon属性: iconProperty
    });
    
    // 检查颜色是否启用（type === 1）
    const colorEnabled = colorProperty && colorProperty.type === 1;
    
    // 检查图标是否启用（type === 1）
    const iconEnabled = iconProperty && iconProperty.type === 1;
    
    const result = {
      colorValue: colorEnabled ? (colorProperty.value || null) : null,
      iconValue: iconEnabled ? (iconProperty.value || null) : null,
      colorEnabled: !!colorEnabled,
      iconEnabled: !!iconEnabled
    };
    
    // 缓存结果
    dataCache.setBlockProperties(blockId, result);
    
    return result;
  } catch (error) {
    const result = { colorValue: null, iconValue: null, colorEnabled: false, iconEnabled: false };
    dataCache.setBlockProperties(blockId, result);
    return result;
  }
}

/**
 * 读取所有面板中的容器块 data-id，并筛选出带标签且启用了颜色的块（使用缓存优化）
 */
async function readAllPanelsContainerBlocks(viewPanels: any[]) {
  // 检查面板结构是否发生变化，如果变化则清除DOM缓存
  if (domCache.checkPanelStructureChange()) {
    domCache.clearAllCache();
  }
  
  // 清理所有之前的观察元素
  unifiedObserver.clearAllObservedElements();
  
  for (const panel of viewPanels) {
    const panelId = panel.id;
    
    // 使用DOM缓存获取面板元素
    const panelElement = domCache.getPanelElement(panelId);
    
    if (!panelElement) {
      continue;
    }
    
    // 使用DOM缓存获取容器块元素
    const containerElements = domCache.getContainerElements(panelId);
    
    // 筛选出带标签的容器块，以及自身设置了_color的容器块和内联引用
    const taggedBlocksPromises: Promise<{ 
      blockId: string; 
      aliasBlockId: number; 
      colorValue: string | null; 
      iconValue: string | null;
      colorSource: 'block' | 'tag'; // 标记颜色来源
      domColor: string | null; // DOM 上标签的实际颜色（如果 colorValue 为 null 则为 null）
      elementType: 'container' | 'inline-ref'; // 标记元素类型
    } | null>[] = [];
    
    // 优化：批量处理容器块，减少DOM查询次数
    const containerPromises = Array.from(containerElements).map(async (element) => {
      // 查找该容器块下的 .orca-repr-main 元素
      const reprMainElement = element.querySelector('.orca-repr-main');
      
      if (!reprMainElement) return null;
      
      const dataId = element.getAttribute('data-id');
      if (!dataId) return null;
      
      // 检查 .orca-repr-main 下是否有 .orca-tags
      const tagsElement = reprMainElement.querySelector('.orca-tags');
      const hasTags = tagsElement && tagsElement.querySelector('.orca-tag');
      
      if (hasTags) {
        // 有标签的情况：使用标签处理逻辑
        try {
          const blockIdNum = parseInt(dataId, 10);
          
          // 1. 获取块的完整信息（包含refs）
          const blockData = await orca.invokeBackend("get-block", blockIdNum);
          
          // 2. 从refs中获取第一个type=2的标签引用
          if (!blockData.refs || blockData.refs.length === 0) {
            return null; // 没有引用信息，跳过
          }
          
          // 找到第一个type=2的引用（标签）
          const firstTagRef = blockData.refs.find((ref: any) => ref.type === 2);
          if (!firstTagRef) {
            return null; // 没有标签引用，跳过
          }
          
          const aliasBlockId = firstTagRef.to;
          
          if (!aliasBlockId) {
            return null; // 引用信息不完整，跳过
          }
          
          // 3. 获取标签的属性（用于读取图标，可能还需要读取颜色）
          const tagStyleProps = await getBlockStyleProperties(aliasBlockId);
          
          // 4. 检查容器块本身是否启用了颜色且有值（最高优先级）
          const blockStyleProps = await getBlockStyleProperties(blockIdNum);
          
          // 如果容器块本身启用了颜色且有值，使用容器块的颜色 + 优先使用容器块的图标，无图标时使用标签的图标
          if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
            const finalDomColor = calculateDomColor(blockStyleProps.colorValue);
            
            // 图标优先级：容器块自身图标 > 标签图标
            const finalIconValue = blockStyleProps.iconValue || tagStyleProps.iconValue;
            
            debugLog(`容器块 ${blockIdNum} 图标处理:`, {
              自身块图标: blockStyleProps.iconValue,
              自身块图标启用: blockStyleProps.iconEnabled,
              标签图标: tagStyleProps.iconValue,
              标签图标启用: tagStyleProps.iconEnabled,
              最终图标: finalIconValue
            });
            
            return {
              blockId: dataId,
              aliasBlockId: aliasBlockId, // 使用从refs获取的块ID
              colorValue: blockStyleProps.colorValue,
              iconValue: finalIconValue, // 优先使用容器块图标，无图标时使用标签图标
              colorSource: 'block' as const,
              domColor: finalDomColor,
              elementType: 'container' as const
            };
          }
          
          // 5. 如果容器块没有颜色值（未启用或值为null），检查容器块是否有图标
          // 图标优先级：容器块自身图标 > 标签图标
          if (blockStyleProps.iconEnabled && blockStyleProps.iconValue) {
            // 容器块有图标，使用容器块的图标
            debugLog(`容器块 ${blockIdNum} 只有图标没有颜色:`, {
              自身块图标: blockStyleProps.iconValue,
              自身块图标启用: blockStyleProps.iconEnabled
            });
            
            return {
              blockId: dataId,
              aliasBlockId: aliasBlockId,
              colorValue: '#666666', // 使用默认颜色
              iconValue: blockStyleProps.iconValue, // 使用容器块自身的图标
              colorSource: 'block' as const,
              domColor: calculateDomColor('#666666'),
              elementType: 'container' as const
            };
          }
          
          // 6. 如果容器块既没有颜色也没有图标，使用标签的颜色 + 标签的图标
          // 注意：即使标签没有颜色，如果有图标也应该处理
          if (!tagStyleProps.colorEnabled || !tagStyleProps.colorValue) {
            // 如果标签既没有颜色也没有图标，跳过
            if (!tagStyleProps.iconEnabled || !tagStyleProps.iconValue) {
              return null;
            }
            // 如果标签有图标但没有颜色，使用默认颜色处理
            debugLog(`标签块 ${aliasBlockId} 只有图标没有颜色:`, {
              标签图标: tagStyleProps.iconValue,
              标签图标启用: tagStyleProps.iconEnabled
            });
            
            return {
              blockId: dataId,
              aliasBlockId: aliasBlockId,
              colorValue: '#666666', // 使用默认颜色
              iconValue: tagStyleProps.iconValue,
              colorSource: 'tag' as const,
              domColor: calculateDomColor('#666666'),
              elementType: 'container' as const
            };
          }
          
          const finalDomColor = calculateDomColor(tagStyleProps.colorValue);
          
          debugLog(`标签块 ${aliasBlockId} 图标处理:`, {
            标签图标: tagStyleProps.iconValue,
            标签图标启用: tagStyleProps.iconEnabled
          });
          
          return {
            blockId: dataId,
            aliasBlockId: aliasBlockId, // 使用从refs获取的块ID
            colorValue: tagStyleProps.colorValue,
            iconValue: tagStyleProps.iconValue, // 图标从标签读取
            colorSource: 'tag' as const,
            domColor: finalDomColor,
            elementType: 'container' as const
          };
        } catch (error) {
          return null;
        }
      } else {
        // 没有标签的情况：检查是否自身设置了_color
        try {
          const blockIdNum = parseInt(dataId, 10);
          
          // 检查容器块自身是否设置了_color属性
          const blockStyleProps = await getBlockStyleProperties(blockIdNum);
          
          if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
            const finalDomColor = calculateDomColor(blockStyleProps.colorValue);
            
            return {
              blockId: dataId,
              aliasBlockId: blockIdNum, // 使用自身块ID
              colorValue: blockStyleProps.colorValue,
              iconValue: blockStyleProps.iconValue, // 从自身读取图标
              colorSource: 'block' as const,
              domColor: finalDomColor,
              elementType: 'container' as const
            };
          }
          
          return null; // 没有启用颜色，跳过
        } catch (error) {
          return null;
        }
      }
    });
    
    // 添加容器块处理结果
    taggedBlocksPromises.push(...containerPromises);
    
    // 处理内联引用元素
    const inlineRefElements = panelElement.querySelectorAll('.orca-inline-r-content');
    inlineRefElements.forEach((contentElement) => {
      // 查找上层的内联引用元素
      const inlineElement = contentElement.closest('.orca-inline[data-type="r"]');
      if (inlineElement) {
        const refId = inlineElement.getAttribute('data-ref');
        if (refId) {
          const promise = (async () => {
            try {
              const blockIdNum = parseInt(refId, 10);
              
              // 1. 获取块的完整信息（包含refs）
              const blockData = await orca.invokeBackend("get-block", blockIdNum);
              
              // 2. 检查自身块是否设置了_color属性（最高优先级）
              const blockStyleProps = await getBlockStyleProperties(blockIdNum);
              
              if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
                const finalDomColor = calculateDomColor(blockStyleProps.colorValue);
                
                // 对于内联引用，如果自身块有颜色但无图标，尝试从标签获取图标
                let finalIconValue = blockStyleProps.iconValue;
                
                // 如果自身块没有图标，尝试从第一个标签获取
                if (!finalIconValue && blockData.refs && blockData.refs.length > 0) {
                  const firstTagRef = blockData.refs.find((ref: any) => ref.type === 2);
                  if (firstTagRef && firstTagRef.to) {
                    const tagStyleProps = await getBlockStyleProperties(firstTagRef.to);
                    finalIconValue = tagStyleProps.iconValue;
                  }
                }
                
                return {
                  blockId: refId,
                  aliasBlockId: blockIdNum, // 使用自身块ID
                  colorValue: blockStyleProps.colorValue,
                  iconValue: finalIconValue, // 优先使用自身图标，无图标时使用标签图标
                  colorSource: 'block' as const,
                  domColor: finalDomColor,
                  elementType: 'inline-ref' as const
                };
              }
              
              // 3. 如果自身块没有颜色，尝试从第一个标签读取
              if (!blockData.refs || blockData.refs.length === 0) {
                return null; // 没有引用信息，跳过
              }
              
              // 找到第一个type=2的引用（标签）
              const firstTagRef = blockData.refs.find((ref: any) => ref.type === 2);
              if (!firstTagRef) {
                return null; // 没有标签引用，跳过
              }
              
              const aliasBlockId = firstTagRef.to;
              
              if (!aliasBlockId) {
                return null; // 引用信息不完整，跳过
              }
              
              // 4. 获取标签的属性
              const tagStyleProps = await getBlockStyleProperties(aliasBlockId);
              
              if (!tagStyleProps.colorEnabled || !tagStyleProps.colorValue) {
                return null; // 标签也未启用颜色或没有颜色值，跳过
              }
              
              const finalDomColor = calculateDomColor(tagStyleProps.colorValue);
              
              return {
                blockId: refId,
                aliasBlockId: aliasBlockId, // 使用标签块ID
                colorValue: tagStyleProps.colorValue,
                iconValue: tagStyleProps.iconValue, // 从标签读取图标
                colorSource: 'tag' as const,
                domColor: finalDomColor,
                elementType: 'inline-ref' as const
              };
            } catch (error) {
              return null;
            }
          })();
          
          taggedBlocksPromises.push(promise);
        }
      }
    });
    
    // 等待所有异步操作完成
    const allResults = await Promise.all(taggedBlocksPromises);
    
    // 过滤掉 null 值（未启用颜色的块）
    const taggedBlocks = allResults.filter((item): item is { 
      blockId: string; 
      aliasBlockId: number; 
      colorValue: string | null; 
      iconValue: string | null;
      colorSource: 'block' | 'tag';
      domColor: string | null;
      elementType: 'container' | 'inline-ref';
    } => item !== null);
    
    debugLog(`面板 [${panelId}] 异步处理完成:`, {
      总处理数量: allResults.length,
      成功处理数量: taggedBlocks.length,
      失败数量: allResults.length - taggedBlocks.length
    });
    
    // 先清除当前面板的所有容器块样式（使用缓存的容器元素）
    containerElements.forEach((element) => {
      const handleElements = element.querySelectorAll('.orca-block-handle');
      handleElements.forEach(handleElement => {
        if (handleElement instanceof HTMLElement) {
          handleElement.style.removeProperty('color');
          handleElement.style.removeProperty('background-color');
          handleElement.style.removeProperty('opacity');
          // 注意：不清理 data-icon，避免清理自身块设置的图标
        }
      });
      
      // 清除标题样式
      const titleElements = element.querySelectorAll('.orca-repr-title');
      titleElements.forEach(titleElement => {
        if (titleElement instanceof HTMLElement) {
          titleElement.style.removeProperty('color');
        }
      });
    });
    
    // 清除内联引用样式
    const allInlineRefElements = panelElement.querySelectorAll('.orca-inline-r-content');
    allInlineRefElements.forEach((contentElement) => {
      if (contentElement instanceof HTMLElement) {
        contentElement.style.removeProperty('color');
      }
    });
    
    // 调试信息：显示处理结果
    debugLog(`面板 [${panelId}] 处理完成:`, {
      找到的容器块数量: containerElements.length,
      启用了颜色的块数量: taggedBlocks.length,
      启用了颜色的块: taggedBlocks.map(block => ({
        blockId: block.blockId,
        colorValue: block.colorValue,
        iconValue: block.iconValue,
        colorSource: block.colorSource,
        elementType: block.elementType
      }))
    });
    
    // 只输出启用了颜色的容器块（包含块ID、标签名、别名块ID、颜色值、图标值和DOM颜色）
    if (taggedBlocks.length > 0) {
      // 获取插件设置
      const settings = orca.state.plugins[pluginName]?.settings;
      const useDomColor = settings?.useDomColor ?? false;

      // 为每个启用颜色的块应用样式
      taggedBlocks.forEach(block => {
        // colorValue 必须存在（用于背景色）
        if (!block.colorValue) {
          return;
        }
        
        // 根据颜色来源和主题模式决定显示颜色（用于前景色）
        let displayColor: string;
        if (block.colorSource === 'block') {
          // 如果颜色来自 block 自身，始终使用 colorValue
          displayColor = block.colorValue;
        } else {
          // 如果颜色来自 tag，根据主题模式决定
          // 暗色模式：使用 domColor（如果启用 useDomColor）
          // 亮色模式：始终使用 colorValue
          if (isDarkMode() && useDomColor) {
            displayColor = block.domColor || block.colorValue;
          } else {
            displayColor = block.colorValue;
          }
        }
        
        const bgColorValue = block.colorValue; // 背景色始终使用 colorValue
        const iconValue = block.iconValue; // 图标值
        
        if (block.elementType === 'container') {
          // 容器块：使用 data-id 查找元素
          const blockElements = panelElement.querySelectorAll(`[data-id="${block.blockId}"]`);
          
          blockElements.forEach(blockElement => {
            // 应用无序点颜色样式和图标
            applyBlockHandleColor(blockElement, displayColor, bgColorValue, iconValue);
            
            // 监听折叠/展开状态变化
            observeBlockHandleCollapse(blockElement, displayColor, bgColorValue, iconValue);
          });
        } else if (block.elementType === 'inline-ref') {
          // 内联引用：使用 data-ref 查找元素
          const inlineElements = panelElement.querySelectorAll(`.orca-inline[data-ref="${block.blockId}"]`);
          
          inlineElements.forEach(inlineElement => {
            // 应用内联引用颜色样式
            applyInlineRefColor(inlineElement, displayColor);
          });
        }
      });
    }
  }
}

export async function load(_name: string) {
  pluginName = _name;

  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  // 注入CSS样式
  orca.themes.injectCSSResource("styles.css", `${pluginName}-styles`);

  // 注册设置 schema
  await orca.plugins.setSettingsSchema(pluginName, settingsSchema);

  // 注册命令：获取所有面板块ID
  orca.commands.registerCommand(
    `${pluginName}.getAllPanelBlockIds`,
    async () => {
      await getAllPanelBlockIds();
    },
    "获取所有面板的块ID"
  );

  // 启动统一观察器
  unifiedObserver.startObserver();
  
  // 启动定期清理任务（每5分钟清理一次过期缓存）
  cleanupInterval = setInterval(() => {
    dataCache.cleanupExpiredCache();
    debugLog('执行定期缓存清理');
  }, 5 * 60 * 1000); // 5分钟
  
  // 插件加载时延迟执行初始化（给DOM渲染留出时间）
  debugLog(`将在 ${INITIAL_DELAY}ms 后开始初始化`);
  setTimeout(() => initializeWithRetry(), INITIAL_DELAY);

  // 监听面板变化和设置变化
  if (window.Valtio?.subscribe) {
    unsubscribe = window.Valtio.subscribe(orca.state, () => {
      // 使用防抖函数，避免频繁触发
      debounceGetPanelBlockIds();
    });
  }
}

export async function unload() {
  // 移除注入的CSS样式
  orca.themes.removeCSSResources(`${pluginName}-styles`);
  
  // 停止统一观察器
  unifiedObserver.stopObserver();
  
  // 清理所有缓存
  dataCache.clearAllCache();
  domCache.clearAllCache();
  
  // 清理防抖定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  
  // 清理定期清理任务
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  
  // 取消状态监听
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  
  // 清理注册的命令
  orca.commands.unregisterCommand(`${pluginName}.getAllPanelBlockIds`);
}
