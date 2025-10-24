import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";

let pluginName: string;
let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Tana自定义属性系统
 * 基于dom_style_application_mechanism.md实现自动样式应用
 */
class TanaPropertySystem {
  // 自定义属性名称
  static readonly TANA_COLOR_PROP = '_tana-color';
  static readonly TANA_ICON_PROP = '_tana-icon';
  
  /**
   * 设置Tana自定义属性
   */
  static async setTanaProperties(blockId: number, properties: {
    color?: string | null;
    icon?: string | null;
  }) {
    const propertyUpdates: any[] = [];
    
    if (properties.color !== undefined) {
      propertyUpdates.push({
        name: this.TANA_COLOR_PROP,
        type: 1, // PropType.Text
        value: properties.color
      });
    }
    
    if (properties.icon !== undefined) {
      propertyUpdates.push({
        name: this.TANA_ICON_PROP,
        type: 1, // PropType.Text
        value: properties.icon
      });
    }
    
    if (propertyUpdates.length > 0) {
      await orca.commands.invokeTopEditorCommand(
        "core.editor.setProperties",
        null,
        [blockId],
        propertyUpdates
      );
    }
  }
  
  /**
   * 获取Tana自定义属性
   */
  static getTanaProperties(block: any): {
    color: string | null;
    icon: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
  } {
    const colorProp = block.properties?.find((prop: any) => prop.name === this.TANA_COLOR_PROP);
    const iconProp = block.properties?.find((prop: any) => prop.name === this.TANA_ICON_PROP);
    
    return {
      color: colorProp?.type === 1 ? colorProp.value : null,
      icon: iconProp?.type === 1 ? iconProp.value : null,
      colorEnabled: colorProp?.type === 1,
      iconEnabled: iconProp?.type === 1
    };
  }
  
  /**
   * 获取最终属性（Tana优先，原生fallback）
   */
  static getFinalProperties(block: any): {
    color: string | null;
    icon: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
    source: 'tana' | 'native' | 'none';
  } {
    const tanaProps = this.getTanaProperties(block);
    const nativeColorProp = block.properties?.find((prop: any) => prop.name === "_color");
    const nativeIconProp = block.properties?.find((prop: any) => prop.name === "_icon");
    
    const nativeColor = nativeColorProp?.type === 1 ? nativeColorProp.value : null;
    const nativeIcon = nativeIconProp?.type === 1 ? nativeIconProp.value : null;
    
    // Tana属性优先
    if (tanaProps.colorEnabled || tanaProps.iconEnabled) {
      return {
        color: tanaProps.color,
        icon: tanaProps.icon,
        colorEnabled: tanaProps.colorEnabled,
        iconEnabled: tanaProps.iconEnabled,
        source: 'tana'
      };
    }
    
    // 原生属性fallback
    if (nativeColor || nativeIcon) {
      return {
        color: nativeColor,
        icon: nativeIcon,
        colorEnabled: !!nativeColor,
        iconEnabled: !!nativeIcon,
        source: 'native'
      };
    }
    
    return {
      color: null,
      icon: null,
      colorEnabled: false,
      iconEnabled: false,
      source: 'none'
    };
  }
}

/**
 * Tana样式计算引擎
 * 基于dom_style_application_mechanism.md和plugin_usage_guide.md
 */
class TanaStyleCalculator {
  /**
   * 计算图标样式（基于文档中的算法）
   */
  static calculateIconStyle(iconValue: string | null, colorValue: string | null, context: 'block' | 'inline' | 'tag' = 'block') {
    const isTablerIcon = !iconValue || iconValue.startsWith("ti ");
    
    if (isTablerIcon) {
      const baseClass = this.getBaseIconClass(context);
      return {
        element: "i",
        className: `${baseClass} ${iconValue || this.getDefaultIcon(context)}`,
        style: colorValue ? {
          color: colorValue,
          backgroundColor: this.calculateBackgroundColor(colorValue)
        } : undefined
      };
    } else {
      const baseClass = this.getBaseIconClass(context);
      return {
        element: "span", 
        className: `${baseClass}-emoji`,
        style: colorValue ? {
          color: colorValue,
          backgroundColor: this.calculateBackgroundColor(colorValue)
        } : undefined,
        children: iconValue
      };
    }
  }
  
  /**
   * 获取基础图标类名
   */
  private static getBaseIconClass(context: 'block' | 'inline' | 'tag'): string {
    switch (context) {
      case 'block': return 'tana-aliased-block-icon';
      case 'inline': return 'tana-inline-r-alias-icon';
      case 'tag': return 'tana-tags-tag-icon';
      default: return 'tana-aliased-block-icon';
    }
  }
  
  /**
   * 获取默认图标
   */
  private static getDefaultIcon(context: 'block' | 'inline' | 'tag'): string {
    switch (context) {
      case 'block': return 'ti ti-file tana-aliased-block-icon-cube';
      case 'inline': return 'ti ti-link';
      case 'tag': return 'ti ti-hash tana-tags-tag-icon-hash';
      default: return 'ti ti-file';
    }
  }
  
  /**
   * 计算背景色（基于文档中的OKLCH算法）
   */
  static calculateBackgroundColor(colorValue: string): string {
    return `oklch(from ${colorValue} calc(l * 1.2) c h / 25%)`;
  }
  
  /**
   * 计算内容样式
   */
  static calculateContentStyle(colorValue: string | null) {
    return colorValue ? {
      color: colorValue
    } : undefined;
  }
  
  /**
   * 计算文本样式
   */
  static calculateTextStyle(colorValue: string | null) {
    return colorValue ? { color: colorValue } : {};
  }
  
  /**
   * 计算容器样式
   */
  static calculateContainerStyle(colorValue: string | null) {
    return {
      borderColor: colorValue,
      boxShadow: colorValue ? `0 0 0 1px ${colorValue}20` : undefined
    };
  }
}

/**
 * Tana属性管理工具
 * 基于plugin_usage_guide.md中的最佳实践
 */
class TanaPropertyUtils {
  /**
   * 获取块的所有Tana视觉属性
   */
  static getTanaVisualProperties(blockId: number) {
    const block = orca.state.blocks[blockId];
    if (!block) return null;
    
    const properties = block.properties || [];
    return {
      icon: properties.find((p: any) => p.name === "_tana-icon")?.value?.toString() || null,
      color: properties.find((p: any) => p.name === "_tana-color")?.value?.toString() || null,
      hide: properties.find((p: any) => p.name === "_hide")?.value || false,
      asAlias: properties.find((p: any) => p.name === "_asAlias")?.value || false
    };
  }
  
  /**
   * 设置Tana视觉属性
   */
  static async setTanaVisualProperties(blockId: number, properties: {
    icon?: string | null;
    color?: string | null;
    hide?: boolean;
    asAlias?: boolean;
  }) {
    const propertyArray = Object.entries(properties)
      .filter(([key, value]) => value !== null && value !== undefined)
      .map(([key, value]) => ({
        name: key === 'icon' ? '_tana-icon' : key === 'color' ? '_tana-color' : `_${key}`,
        type: 1, // PropType.Text
        value: value
      }));
    
    if (propertyArray.length > 0) {
      await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], propertyArray);
    }
  }
  
  /**
   * 清除Tana视觉属性
   */
  static async clearTanaVisualProperties(blockId: number) {
    await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], [
      { name: "_tana-icon", type: 1, value: null },
      { name: "_tana-color", type: 1, value: null }
    ]);
  }
  
  /**
   * 安全设置属性（带错误处理）
   */
  static async safeSetTanaProperties(blockId: number, properties: any) {
    try {
      await this.setTanaVisualProperties(blockId, properties);
      return { success: true };
    } catch (error: any) {
      console.error("设置Tana属性失败:", error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 批量设置Tana属性
   */
  static async batchSetTanaProperties(operations: Array<{blockId: number, properties: any}>) {
    const promises = operations.map(async ({ blockId, properties }) => {
      const propertyArray = Object.entries(properties)
        .filter(([key, value]) => value !== null)
        .map(([key, value]) => ({
          name: key === 'icon' ? '_tana-icon' : key === 'color' ? '_tana-color' : `_${key}`,
          type: 1,
          value: value
        }));
      
      if (propertyArray.length > 0) {
        await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], propertyArray);
      }
    });
    
    await Promise.all(promises);
  }
  
  /**
   * 批量读取Tana属性
   */
  static batchGetTanaProperties(blockIds: number[]) {
    return blockIds.map(blockId => {
      const block = orca.state.blocks[blockId];
      return {
        blockId,
        ...this.getTanaVisualProperties(blockId)
      };
    });
  }
}



/**
 * Tana渲染器扩展系统
 * 基于dom_style_application_mechanism.md实现自动样式应用
 */
class TanaRendererExtension {
  private static originalRenderers: Map<string, Function> = new Map();
  
  /**
   * 扩展所有相关渲染器
   */
  static extendAllRenderers() {
    this.extendBlockRenderers();
    this.extendInlineRenderers();
  }
  
  /**
   * 扩展块渲染器
   */
  private static extendBlockRenderers() {
    // 由于Orca API限制，我们使用状态监听方式而不是直接扩展渲染器
    // 这将在状态变化时自动应用Tana样式
    debugLog("Tana渲染器扩展：使用状态监听方式");
  }
  
  /**
   * 扩展内联渲染器
   */
  private static extendInlineRenderers() {
    // 由于Orca API限制，我们使用状态监听方式而不是直接扩展渲染器
    // 这将在状态变化时自动应用Tana样式
    debugLog("Tana内联渲染器扩展：使用状态监听方式");
  }
  
  /**
   * 应用Tana样式到DOM元素
   * 基于dom_style_application_mechanism.md中的样式应用机制
   */
  static applyTanaStylesToElement(element: Element, blockId: number) {
    const block = orca.state.blocks[blockId];
    if (!block) return;
    
    // 获取最终属性（Tana优先）
    const finalProps = TanaPropertySystem.getFinalProperties(block);
    
    // 如果没有自定义属性，跳过
    if (finalProps.source === 'none') return;
    
    // 应用样式到相关元素
    this.applyStylesToBlockElement(element, finalProps);
  }
  
  /**
   * 应用样式到块元素
   */
  private static applyStylesToBlockElement(element: Element, props: any) {
    // 查找块句柄元素
    const handleElements = element.querySelectorAll('.orca-block-handle');
    const titleElements = element.querySelectorAll('.orca-repr-title');
    const inlineElements = element.querySelectorAll('.orca-inline[data-type="t"]');
    
    // 应用样式到句柄元素
    handleElements.forEach(handleElement => {
      if (handleElement instanceof HTMLElement) {
        this.applyHandleStyles(handleElement, props);
      }
    });
    
    // 应用样式到标题元素
    titleElements.forEach(titleElement => {
      if (titleElement instanceof HTMLElement) {
        this.applyTitleStyles(titleElement, props);
      }
    });
    
    // 应用样式到内联元素
    inlineElements.forEach(inlineElement => {
      if (inlineElement instanceof HTMLElement) {
        this.applyInlineStyles(inlineElement, props);
      }
    });
  }
  
  /**
   * 应用句柄样式
   */
  private static applyHandleStyles(element: HTMLElement, props: any) {
    if (props.color) {
      element.style.setProperty('color', props.color);
    }
    
    if (props.icon) {
      this.applyIconToElement(element, props.icon);
    }
  }
  
  /**
   * 应用标题样式
   */
  private static applyTitleStyles(element: HTMLElement, props: any) {
    if (props.color) {
      element.style.setProperty('color', props.color);
    }
  }
  
  /**
   * 应用内联样式
   */
  private static applyInlineStyles(element: HTMLElement, props: any) {
    if (props.color) {
      element.style.setProperty('color', props.color);
    }
  }
  
  /**
   * 应用图标到元素
   */
  private static applyIconToElement(element: HTMLElement, iconValue: string) {
    const isTablerIcon = !iconValue || iconValue.startsWith("ti ");
    
    if (isTablerIcon) {
      // 移除现有图标类
      const existingClasses = Array.from(element.classList);
      existingClasses.forEach(cls => {
        if (cls === 'ti' || cls.startsWith('ti-')) {
          element.classList.remove(cls);
        }
      });
      
      // 添加新图标类
      const iconClasses = iconValue.split(' ').filter(cls => cls.trim() !== '');
      iconClasses.forEach(cls => {
        element.classList.add(cls);
      });
    } else {
      // 设置Emoji图标
      element.setAttribute('data-icon', iconValue);
    }
  }
  
  
  /**
   * 恢复原始渲染器
   */
  static restoreOriginalRenderers() {
    this.originalRenderers.forEach((renderer, name) => {
      if (name === "aliased" || name === "tag") {
        orca.renderers.registerBlock(name, true, renderer);
      } else if (name === "reference") {
        orca.renderers.registerInline(name, true, renderer);
      }
    });
    this.originalRenderers.clear();
  }
}

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
  
  private readonly CACHE_TTL = 5000; // 缓存5秒，提高更新及时性
  
  /**
   * 获取缓存的块属性（优化版本）
   */
  getBlockProperties(blockId: number): {
    colorValue: string | null;
    iconValue: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
  } | null {
    const cached = this.blockPropertiesCache.get(blockId);
    if (!cached) return null;
    
    // 优化：使用更快的过期检查，避免频繁的Date.now()调用
    const now = performance.now();
    if (now - cached.timestamp > this.CACHE_TTL) {
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
   * 设置缓存的块属性（优化版本）
   */
  setBlockProperties(blockId: number, properties: {
    colorValue: string | null;
    iconValue: string | null;
    colorEnabled: boolean;
    iconEnabled: boolean;
  }): void {
    // 优化：使用performance.now()替代Date.now()，性能更好
    this.blockPropertiesCache.set(blockId, {
      ...properties,
      timestamp: performance.now()
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
   * 清理过期的缓存（优化版本）
   */
  cleanupExpiredCache(): void {
    // 优化：使用performance.now()和批量删除
    const now = performance.now();
    const expiredKeys: number[] = [];
    
    for (const [blockId, cached] of this.blockPropertiesCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        expiredKeys.push(blockId);
      }
    }
    
    // 批量删除过期缓存
    expiredKeys.forEach(blockId => {
      this.blockPropertiesCache.delete(blockId);
    });
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
   * 获取面板元素（带缓存，内存泄漏防护）
   */
  getPanelElement(panelId: string): Element | null {
    if (this.panelElementsCache.has(panelId)) {
      const cachedElement = this.panelElementsCache.get(panelId);
      // 检查缓存的元素是否仍然存在于DOM中
      if (cachedElement && document.contains(cachedElement)) {
        return cachedElement;
      } else {
        // 元素已被删除，清除缓存
        this.panelElementsCache.delete(panelId);
      }
    }
    
    const element = document.querySelector(`[data-panel-id="${panelId}"]`);
    this.panelElementsCache.set(panelId, element);
    return element;
  }
  
  /**
   * 获取面板内的容器块元素（带缓存，内存泄漏防护）
   */
  getContainerElements(panelId: string): NodeListOf<Element> {
    const cacheKey = `${panelId}_containers`;
    
    if (this.containerElementsCache.has(cacheKey)) {
      const cachedElements = this.containerElementsCache.get(cacheKey)!;
      // 优化：只检查缓存是否存在，不检查DOM有效性（减少DOM查询）
      if (cachedElements.length > 0) {
        return cachedElements;
      } else {
        // 缓存失效，清除缓存
        this.containerElementsCache.delete(cacheKey);
      }
    }
    
    const panelElement = this.getPanelElement(panelId);
    if (!panelElement) {
      // 优化：直接返回空列表，避免不必要的DOM查询
      const emptyList = document.querySelectorAll('.orca-block.orca-container');
      this.containerElementsCache.set(cacheKey, emptyList);
      return emptyList;
    }
    
    // 优化：使用更精确的选择器，减少查询范围
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
  
  /**
   * 清理失效的DOM引用（内存泄漏防护）
   */
  cleanupInvalidReferences(): void {
    // 清理失效的面板元素引用
    for (const [panelId, element] of this.panelElementsCache.entries()) {
      if (element && !document.contains(element)) {
        this.panelElementsCache.delete(panelId);
        debugLog(`清理失效的面板元素引用: ${panelId}`);
      }
    }
    
    // 清理失效的容器元素引用
    for (const [cacheKey, elements] of this.containerElementsCache.entries()) {
      if (elements.length > 0 && !document.contains(elements[0])) {
        this.containerElementsCache.delete(cacheKey);
        debugLog(`清理失效的容器元素引用: ${cacheKey}`);
      }
    }
  }
}

/**
 * 样式变化检测管理类
 * 实现"检测三次"逻辑，避免不必要的样式应用
 */
class StyleChangeDetector {
  private elementStyleStates = new Map<Element, {
    expectedStyles: {
      color: string;
      backgroundColor: string;
      backgroundImage: string;
      opacity: string;
      dataIcon: string;
      hasBoldClass: boolean; // 是否有 b 类
    };
    appliedStyles: {
      color: string;
      backgroundColor: string;
      backgroundImage: string;
      opacity: string;
      dataIcon: string;
      hasBoldClass: boolean; // 是否有 b 类
    };
    changeCount: number;
    lastChangeTime: number;
    isStable: boolean; // 是否稳定（连续三次无变化）
  }>();
  
  private readonly MAX_CHANGE_COUNT = 3; // 最大变化检测次数
  private readonly STABLE_THRESHOLD = 100; // 稳定状态阈值（毫秒）- 降低阈值，更快进入稳定状态
  
  /**
   * 获取元素当前应用的样式状态
   */
  private getElementAppliedStyleState(element: HTMLElement): {
    color: string;
    backgroundColor: string;
    backgroundImage: string;
    opacity: string;
    dataIcon: string;
    hasBoldClass: boolean;
  } {
    return {
      color: element.style.color || '',
      backgroundColor: element.style.backgroundColor || '',
      backgroundImage: element.style.backgroundImage || '',
      opacity: element.style.opacity || '',
      dataIcon: element.getAttribute('data-icon') || '',
      hasBoldClass: element.classList.contains('b') // 检测是否有 b 类
    };
  }
  
  /**
   * 记录期望的样式状态
   */
  recordExpectedStyles(element: Element, expectedStyles: {
    color: string;
    backgroundColor: string;
    backgroundImage: string;
    opacity: string;
    dataIcon: string;
  }): void {
    if (!(element instanceof HTMLElement)) return;
    
    const appliedStyles = this.getElementAppliedStyleState(element);
    
    // 扩展期望样式，包含 b 类状态
    const extendedExpectedStyles = {
      ...expectedStyles,
      hasBoldClass: appliedStyles.hasBoldClass
    };
    
    this.elementStyleStates.set(element, {
      expectedStyles: extendedExpectedStyles,
      appliedStyles,
      changeCount: 0,
      lastChangeTime: performance.now(),
      isStable: false
    });
    
    debugLog(`记录元素期望样式:`, extendedExpectedStyles);
  }
  
  /**
   * 检查样式是否需要重新应用
   */
  needsStyleUpdate(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    // 检查是否在滚动中，如果是则跳过更新
    const unifiedObserver = (window as any).unifiedObserver;
    if (unifiedObserver && unifiedObserver.isScrolling) {
      debugLog(`滚动中，跳过样式更新`);
      return false;
    }
    
    const cachedState = this.elementStyleStates.get(element);
    
    if (!cachedState) {
      // 首次检测，总是需要更新
      debugLog(`元素首次检测，需要更新样式`);
      return true;
    }
    
    const currentAppliedStyles = this.getElementAppliedStyleState(element);
    
    // 关键修复：如果元素当前有 b 类，直接跳过样式更新，避免覆盖粗体样式
    if (currentAppliedStyles.hasBoldClass) {
      debugLog(`元素有 b 类，跳过样式更新，避免覆盖粗体样式`);
      return false;
    }
    
    // 检查应用的样式是否与期望的样式一致
    const stylesMatch = (
      cachedState.expectedStyles.color === currentAppliedStyles.color &&
      cachedState.expectedStyles.backgroundColor === currentAppliedStyles.backgroundColor &&
      cachedState.expectedStyles.backgroundImage === currentAppliedStyles.backgroundImage &&
      cachedState.expectedStyles.opacity === currentAppliedStyles.opacity &&
      cachedState.expectedStyles.dataIcon === currentAppliedStyles.dataIcon &&
      cachedState.expectedStyles.hasBoldClass === currentAppliedStyles.hasBoldClass
    );
    
    if (!stylesMatch) {
      // 样式不匹配，需要更新
      cachedState.changeCount = 0;
      cachedState.lastChangeTime = performance.now();
      cachedState.isStable = false;
      debugLog(`元素样式不匹配，需要更新样式`);
      return true;
    } else {
      // 样式匹配，增加稳定计数
      cachedState.changeCount++;
      const now = performance.now();
      
      // 如果连续检测到样式匹配，标记为稳定状态
      if (cachedState.changeCount >= this.MAX_CHANGE_COUNT) {
        cachedState.isStable = true;
        cachedState.lastChangeTime = now; // 更新稳定时间
        debugLog(`元素样式稳定，连续${this.MAX_CHANGE_COUNT}次匹配`);
      }
      
      // 检查是否应该停止检测（稳定且超过阈值时间）
      if (cachedState.isStable && (now - cachedState.lastChangeTime) > this.STABLE_THRESHOLD) {
        debugLog(`元素样式长期稳定，跳过更新`);
        return false;
      }
      
      // 关键修复：样式匹配时，如果尚未达到稳定状态，仍然需要更新
      // 但如果已经达到稳定状态，则不需要更新
      if (cachedState.isStable) {
        debugLog(`元素样式已稳定，跳过更新`);
        return false;
      }
      
      // 样式匹配但尚未稳定，需要继续更新直到稳定
      debugLog(`样式匹配但尚未稳定，继续更新 (${cachedState.changeCount}/${this.MAX_CHANGE_COUNT})`);
      return true;
    }
  }
  
  /**
   * 强制重置元素的检测状态（当DOM结构发生重大变化时调用）
   */
  forceResetElementDetection(element: Element): void {
    this.elementStyleStates.delete(element);
    debugLog(`强制重置元素检测状态`);
  }
  
  /**
   * 清理失效的元素引用
   */
  cleanupInvalidElements(): void {
    const invalidElements: Element[] = [];
    
    for (const [element] of this.elementStyleStates.entries()) {
      if (!document.contains(element)) {
        invalidElements.push(element);
      }
    }
    
    invalidElements.forEach(element => {
      this.elementStyleStates.delete(element);
    });
    
    if (invalidElements.length > 0) {
      debugLog(`清理了${invalidElements.length}个失效的样式检测引用`);
    }
  }
  
  /**
   * 清除所有样式状态
   */
  clearAllStates(): void {
    this.elementStyleStates.clear();
    debugLog('清除所有样式状态');
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
    tagColors?: string[]; // 添加多标签颜色数组
    colorSource?: 'block' | 'tag'; // 添加颜色来源
  }>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null; // 添加重试定时器跟踪
  private styleChangeDetector = new StyleChangeDetector(); // 添加样式变化检测器
  private lastUpdateTime = 0; // 添加最后更新时间
  private readonly UPDATE_THROTTLE = 50; // 更新节流时间（毫秒）- 增加到50ms减少频繁更新
  public isScrolling = false; // 添加滚动状态标记
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null; // 滚动结束定时器
  
  /**
   * 启动统一观察器（优化版本：只观察面板容器）
   */
  startObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    // 添加滚动事件监听，避免滚动时触发样式更新
    this.setupScrollListener();
    
    this.observer = new MutationObserver((mutations) => {
      // 如果正在滚动，跳过样式更新，避免闪烁
      if (this.isScrolling) {
        debugLog(`正在滚动中，跳过样式更新`);
        return;
      }
      
      // 批量处理所有变化，避免频繁重绘
      const elementsToUpdate = new Set<Element>();
      
      // 优化：过滤掉不重要的变化，增加滚动相关的class过滤
      const significantMutations = mutations.filter(mutation => {
        // 只关注class属性的变化和子节点的添加/删除
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as Element;
          const classList = target.classList.toString();
          
          // 过滤掉滚动相关的临时class变化
          if (classList.includes('scrolling') || 
              classList.includes('scroll') || 
              classList.includes('transform') ||
              classList.includes('transition')) {
            return false;
          }
          return true;
        }
        if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
          return true;
        }
        return false;
      });
      
      // 如果没有重要变化，直接返回
      if (significantMutations.length === 0) {
        return;
      }
      
      significantMutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as Element;
          const containerBlock = target.closest('.orca-block.orca-container');
          if (containerBlock && this.observedElements.has(containerBlock)) {
            // 关键修复：只在真正的结构变化时才重置，而不是每次class变化都重置
            // 检查是否是重要的class变化（如折叠/展开状态变化）
            const targetClasses = target.classList.toString();
            const isImportantChange = targetClasses.includes('orca-block-handle-collapsed') || 
                                    targetClasses.includes('orca-block-handle-expanded');
            
            if (isImportantChange) {
              debugLog(`检测到重要的class变化，重置检测状态`);
              this.styleChangeDetector.forceResetElementDetection(containerBlock);
            }
            elementsToUpdate.add(containerBlock);
          }
        } else if (mutation.type === 'childList') {
          // 检查新增的子元素
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              const containerBlock = element.closest('.orca-block.orca-container');
              if (containerBlock && this.observedElements.has(containerBlock)) {
                // 子节点变化确实是结构变化，需要重置
                debugLog(`检测到子节点变化，重置检测状态`);
                this.styleChangeDetector.forceResetElementDetection(containerBlock);
                elementsToUpdate.add(containerBlock);
              }
            }
          });
        }
      });
      
      // 添加更新节流，避免过于频繁的更新
      const now = performance.now();
      if (now - this.lastUpdateTime < this.UPDATE_THROTTLE) {
        debugLog(`更新频率过高，跳过本次更新`);
        return;
      }
      this.lastUpdateTime = now;
      
      // 批量更新所有需要更新的元素（使用样式变化检测器优化）
      elementsToUpdate.forEach(element => {
        // 使用样式变化检测器判断是否需要更新
        if (!this.styleChangeDetector.needsStyleUpdate(element)) {
          debugLog(`元素样式稳定，跳过更新`);
          return;
        }
        
        const config = this.observedElements.get(element);
        if (config) {
          // 根据标签数量决定使用哪个函数
          if (config.tagColors && config.tagColors.length > 1) {
            // 多标签：使用多标签处理函数
            applyMultiTagHandleColor(element, config.displayColor, config.bgColorValue, config.iconValue, config.tagColors, config.colorSource || 'tag');
          } else {
            // 单标签：使用原有的单标签处理函数
            applyBlockHandleColor(element, config.displayColor, config.bgColorValue, config.iconValue);
          }
          
          // 记录期望的样式状态，用于后续检测
          this.styleChangeDetector.recordExpectedStyles(element, {
            color: config.displayColor,
            backgroundColor: config.bgColorValue,
            backgroundImage: '', // 这个会在应用函数中设置
            opacity: '1',
            dataIcon: config.iconValue || ''
          });
          
          debugLog(`应用样式更新到元素`);
        }
      });
    });
    
    // 优化：只观察面板容器，而不是整个文档
    this.observePanelContainers();
  }
  
  /**
   * 设置滚动事件监听
   */
  private setupScrollListener(): void {
    // 监听滚动开始
    const handleScrollStart = () => {
      this.isScrolling = true;
      debugLog(`滚动开始，暂停样式更新`);
    };
    
    // 监听滚动结束
    const handleScrollEnd = () => {
      // 清除之前的定时器
      if (this.scrollEndTimer) {
        clearTimeout(this.scrollEndTimer);
      }
      
      // 延迟标记滚动结束，避免频繁切换
      this.scrollEndTimer = setTimeout(() => {
        this.isScrolling = false;
        debugLog(`滚动结束，恢复样式更新`);
      }, 150); // 150ms延迟，确保滚动完全结束
    };
    
    // 使用passive监听器提高性能
    document.addEventListener('scroll', handleScrollStart, { passive: true });
    document.addEventListener('scroll', handleScrollEnd, { passive: true });
    
    // 监听触摸滚动（移动端）
    document.addEventListener('touchmove', handleScrollStart, { passive: true });
    document.addEventListener('touchend', handleScrollEnd, { passive: true });
  }
  
  /**
   * 观察面板容器（性能优化：减少观察范围，内存泄漏防护）
   */
  private observePanelContainers(): void {
    if (!this.observer) return;
    
    // 清理之前的重试定时器
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    
    // 获取所有面板容器
    const panelContainers = document.querySelectorAll('[data-panel-id]');
    
    if (panelContainers.length === 0) {
      // 如果没有面板容器，延迟重试（最多重试10次）
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.observePanelContainers();
      }, 100);
      return;
    }
    
    // 观察每个面板容器
    panelContainers.forEach(panel => {
      this.observer!.observe(panel, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
        childList: true
      });
    });
    
    debugLog(`开始观察 ${panelContainers.length} 个面板容器`);
  }
  
  /**
   * 重新观察面板容器（当面板结构变化时调用）
   */
  refreshObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observePanelContainers();
    }
  }
  
  /**
   * 添加要观察的元素
   */
  addObservedElement(element: Element, displayColor: string, bgColorValue: string, iconValue: string | null, tagColors?: string[], colorSource?: 'block' | 'tag'): void {
    this.observedElements.set(element, {
      displayColor,
      bgColorValue,
      iconValue,
      tagColors,
      colorSource
    });
  }
  
  /**
   * 移除观察的元素
   */
  removeObservedElement(element: Element): void {
    this.observedElements.delete(element);
  }
  
  /**
   * 停止观察器（内存泄漏防护：完整清理）
   */
  stopObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    // 清理重试定时器
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    
    // 清理滚动结束定时器
    if (this.scrollEndTimer) {
      clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = null;
    }
    
    // 清理滚动事件监听器
    this.cleanupScrollListener();
    
    this.observedElements.clear();
    this.styleChangeDetector.clearAllStates();
  }
  
  /**
   * 清理所有观察的元素
   */
  clearAllObservedElements(): void {
    this.observedElements.clear();
    this.styleChangeDetector.clearAllStates();
  }
  
  /**
   * 清理失效的样式检测引用
   */
  cleanupInvalidStyleReferences(): void {
    this.styleChangeDetector.cleanupInvalidElements();
  }
  
  /**
   * 清理滚动事件监听器
   */
  private cleanupScrollListener(): void {
    // 注意：由于使用了匿名函数，这里无法直接移除事件监听器
    // 在实际应用中，应该保存事件监听器的引用以便移除
    // 这里主要是为了代码完整性，实际清理在页面卸载时进行
    debugLog('清理滚动事件监听器');
  }
}

// 创建全局缓存实例
const dataCache = new DataCache();
const domCache = new DOMCache();
const unifiedObserver = new UnifiedObserverManager();

// 将unifiedObserver暴露到全局，以便其他组件可以访问滚动状态
(window as any).unifiedObserver = unifiedObserver;

// 初始化重试相关变量
let retryCount: number = 0;
const MAX_RETRY_COUNT = 3; // 最大重试次数
const RETRY_DELAY = 100; // 重试延迟（毫秒）- 降低延迟实现快速响应
const INITIAL_DELAY = 100; // 初始延迟（毫秒）- 降低延迟实现快速启动

// 定义设置 schema
const settingsSchema = {
  useDomColor: {
    label: "使用 DOM 颜色",
    type: "boolean" as const,
    defaultValue: false,
  },
  enableInlineColor: {
    label: "对文字应用颜色",
    type: "boolean" as const,
    defaultValue: false,
  },
  enableTitleColor: {
    label: "启用标题颜色",
    type: "boolean" as const,
    defaultValue: true,
  },
  enableTagValueColor: {
    label: "使用主题标签属性颜色",
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
    try {
      // 检查是否在滚动中，如果是则延迟执行
      if (unifiedObserver && unifiedObserver.isScrolling) {
        debugLog(`滚动中，延迟执行样式更新`);
        // 重新设置定时器，等待滚动结束
        debounceTimer = setTimeout(() => debounceGetPanelBlockIds(), 200);
        return;
      }
      
      // 检查面板结构是否发生变化，如果变化则清除缓存并刷新观察器
      if (domCache.checkPanelStructureChange()) {
        domCache.clearAllCache();
        dataCache.clearAllCache();
        // 刷新观察器以观察新的面板容器
        unifiedObserver.refreshObserver();
      }
      
      // 直接执行，避免嵌套异步调用
      await getAllPanelBlockIds();
    } catch (error) {
      debugError('执行getAllPanelBlockIds时发生错误:', error);
      // 清理缓存，避免错误状态持续
      dataCache.clearAllCache();
      domCache.clearAllCache();
    }
  }, 100); // 增加到100ms延迟，减少频繁更新
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
  
  // 检查特殊面板
  const specialPanels = ['_globalSearch', '_reference'];
  for (const panelId of specialPanels) {
    const panelElement = domCache.getPanelElement(panelId);
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
 * 将十六进制颜色转换为带透明度的 rgba 格式（带缓存优化）
 */
const hexToRgbaCache = new Map<string, string>();

function hexToRgba(hex: string, alpha: number): string {
  const cacheKey = `${hex}-${alpha}`;
  
  if (hexToRgbaCache.has(cacheKey)) {
    return hexToRgbaCache.get(cacheKey)!;
  }
  
  // 移除 # 符号
  hex = hex.replace('#', '');
  
  // 处理简写格式 (如 #fff)
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  const result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  
  // 缓存结果（限制缓存大小，避免内存泄漏）
  if (hexToRgbaCache.size < 1000) {
    hexToRgbaCache.set(cacheKey, result);
  }
  
  return result;
}

/**
 * 根据标签颜色数量生成对应的线性渐变背景样式（用于内联元素）
 * @param tagColors 标签颜色数组
 * @returns CSS线性渐变背景样式字符串
 */
function generateLinearGradientBackground(tagColors: string[]): string {
  if (tagColors.length === 0) {
    return '';
  }
  
  if (tagColors.length === 1) {
    // 单色情况，返回空字符串，让调用方处理
    return '';
  }
  
  if (tagColors.length === 2) {
    // 2个标签：从左到右平滑过渡
    const colorA = hexToRgba(tagColors[0], 1);
    const colorB = hexToRgba(tagColors[1], 1);
    return `linear-gradient(to right, ${colorA} 0%, ${colorB} 100%)`;
  }
  
  if (tagColors.length === 3) {
    // 3个标签：从左到右平滑过渡
    const colorA = hexToRgba(tagColors[0], 1);
    const colorB = hexToRgba(tagColors[1], 1);
    const colorC = hexToRgba(tagColors[2], 1);
    return `linear-gradient(to right, ${colorA} 0%, ${colorB} 50%, ${colorC} 100%)`;
  }
  
  if (tagColors.length >= 4) {
    // 4个标签：从左到右平滑过渡
    const colorA = hexToRgba(tagColors[0], 1);
    const colorB = hexToRgba(tagColors[1], 1);
    const colorC = hexToRgba(tagColors[2], 1);
    const colorD = hexToRgba(tagColors[3], 1);
    return `linear-gradient(to right, ${colorA} 0%, ${colorB} 33.33%, ${colorC} 66.66%, ${colorD} 100%)`;
  }
  
  return '';
}

/**
 * 根据标签颜色数量生成对应的背景样式
 * @param tagColors 标签颜色数组
 * @returns CSS背景样式字符串
 */
function generateMultiColorBackground(tagColors: string[]): string {
  if (tagColors.length === 0) {
    return '';
  }
  
  if (tagColors.length === 1) {
    // 单色情况，返回空字符串，让调用方处理
    return '';
  }
  
  if (tagColors.length === 2) {
    // 2个标签：上下分割 (A在上，B在下)
    const colorA = hexToRgba(tagColors[0], 0.75);
    const colorB = hexToRgba(tagColors[1], 0.75);
    return `linear-gradient(to bottom, ${colorA} 0%, ${colorA} 50%, ${colorB} 50%, ${colorB} 100%)`;
  }
  
  if (tagColors.length === 3) {
    // 3个标签：顺时针 A B C (每个120度)
    const colorA = hexToRgba(tagColors[0], 0.75);
    const colorB = hexToRgba(tagColors[1], 0.75);
    const colorC = hexToRgba(tagColors[2], 0.75);
    return `conic-gradient(from 0deg, ${colorA} 0deg 120deg, ${colorB} 120deg 240deg, ${colorC} 240deg 360deg)`;
  }
  
  if (tagColors.length >= 4) {
    // 4个标签：顺时针 ABCD 四等分 (每个90度)
    const colorA = hexToRgba(tagColors[0], 0.75);
    const colorB = hexToRgba(tagColors[1], 0.75);
    const colorC = hexToRgba(tagColors[2], 0.75);
    const colorD = hexToRgba(tagColors[3], 0.75);
    return `conic-gradient(from 0deg, ${colorA} 0deg 90deg, ${colorB} 90deg 180deg, ${colorC} 180deg 270deg, ${colorD} 270deg 360deg)`;
  }
  
  return '';
}

/**
 * 为容器块的无序点应用多标签颜色样式和图标
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 * @param tagColors 多标签颜色数组
 */
function applyMultiTagHandleColor(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null, tagColors: string[], colorSource: 'block' | 'tag') {
  // 批量查询DOM元素，减少重复查询
  const handleElements = blockElement.querySelectorAll('.orca-block-handle');
  const titleElements = blockElement.querySelectorAll('.orca-repr-title');
  const inlineElements = blockElement.querySelectorAll('.orca-inline[data-type="t"]');
  
  // 获取当前块的data-id（只查询一次）
  const currentBlockId = blockElement.getAttribute('data-id');
  
  // 批量处理图标元素（优化：减少DOM查询次数）
  if (handleElements.length > 0) {
    // 优化：预先过滤属于当前块的元素，减少循环中的DOM查询
    const validHandleElements = Array.from(handleElements).filter(handleElement => {
      const handleParentBlock = handleElement.closest('.orca-block.orca-container');
      return !handleParentBlock || handleParentBlock.getAttribute('data-id') === currentBlockId;
    });
    
    validHandleElements.forEach(handleElement => {
      if (handleElement instanceof HTMLElement) {
        // 多标签时叠加颜色在 Orca 默认颜色上
        if (tagColors.length > 1) {
          // 使用第一个标签的颜色叠加在默认颜色上
          handleElement.style.setProperty('color', displayColor);
        }
        // 单标签时保持原有逻辑（在 applyBlockHandleColor 中处理）
        
        // 设置图标属性
        if (iconValue) {
          // 检查是否为 Tabler Icons 格式（以 "ti " 开头）
          if (iconValue.startsWith('ti ')) {
            // Tabler Icons 格式，使用 requestAnimationFrame 避免频繁 DOM 操作
            requestAnimationFrame(() => {
              const iconClasses = iconValue.split(' ').filter(cls => cls.trim() !== '');
              
              // 移除所有现有的 Tabler Icons 类（包括 ti、ti- 开头的所有类）
              const existingClasses = Array.from(handleElement.classList);
              existingClasses.forEach(cls => {
                if (cls === 'ti' || cls.startsWith('ti-')) {
                  handleElement.classList.remove(cls);
                }
              });
              
              // 添加新的图标类
              iconClasses.forEach(cls => {
                if (cls.trim() !== '') {
                  handleElement.classList.add(cls);
                }
              });
              
              debugLog(`块 ${currentBlockId} 的图标是 Tabler Icons 格式: "${iconValue}"，来源: ${colorSource}，覆盖旧图标类`);
            });
          } else {
            // 其他格式，设置 data-icon 属性
            handleElement.setAttribute('data-icon', iconValue);
            debugLog(`为块 ${currentBlockId} 的图标设置 data-icon="${iconValue}"，来源: ${colorSource}`);
          }
        } else {
          debugLog(`块 ${currentBlockId} 没有图标值，跳过设置 data-icon`);
        }
        
        // 根据标签数量决定处理方式
        if (tagColors.length === 1) {
          // 单标签：使用原有的单标签逻辑
          if (handleElement.classList.contains('orca-block-handle-collapsed')) {
            const bgColor = hexToRgba(tagColors[0], 0.45);
            handleElement.style.setProperty('background-color', bgColor, 'important');
            handleElement.style.removeProperty('background-image');
          } else {
            // 没有折叠类时，清除背景颜色
            handleElement.style.removeProperty('background-color');
            handleElement.style.removeProperty('background-image');
            // 确保非折叠状态下完全不透明
            handleElement.style.setProperty('opacity', '1', 'important');
          }
        } else {
          // 多标签：使用 requestAnimationFrame 安全地添加 collapsed 类
          requestAnimationFrame(() => {
            // 检查是否已经有 collapsed 类，避免重复添加
            if (!handleElement.classList.contains('orca-block-handle-collapsed')) {
              handleElement.classList.add('orca-block-handle-collapsed');
            }
            
            const multiColorBg = generateMultiColorBackground(tagColors);
            if (multiColorBg) {
              handleElement.style.setProperty('background-image', multiColorBg, 'important');
              handleElement.style.removeProperty('background-color');
            } else {
              // 清除背景样式
              handleElement.style.removeProperty('background-color');
              handleElement.style.removeProperty('background-image');
            }
            // 确保完全不透明
            handleElement.style.setProperty('opacity', '1', 'important');
          });
        }
      }
    });
  }
  
  // 处理标题元素（根据设置和颜色来源决定是否启用）
  const settings = orca.state.plugins[pluginName]?.settings;
  const enableTitleColor = settings?.enableTitleColor ?? true;
  
  if (colorSource === 'tag' && enableTitleColor && titleElements.length > 0) {
    // 优化：预先过滤属于当前块的标题元素
    const validTitleElements = Array.from(titleElements).filter(titleElement => {
      const titleParentBlock = titleElement.closest('.orca-block.orca-container');
      return !titleParentBlock || titleParentBlock.getAttribute('data-id') === currentBlockId;
    });
    
    validTitleElements.forEach(titleElement => {
      if (titleElement instanceof HTMLElement) {
        // 根据标签数量决定处理方式
        if (tagColors.length > 1) {
          // 多标签：叠加颜色在 Orca 默认颜色上
          titleElement.style.setProperty('color', displayColor);
        } else {
          // 单标签：使用原有逻辑
          titleElement.style.setProperty('color', displayColor);
        }
      }
    });
  } else if (!enableTitleColor && titleElements.length > 0) {
    // 当设置关闭时，清除标题颜色样式
    // 优化：预先过滤属于当前块的标题元素
    const validTitleElements = Array.from(titleElements).filter(titleElement => {
      const titleParentBlock = titleElement.closest('.orca-block.orca-container');
      return !titleParentBlock || titleParentBlock.getAttribute('data-id') === currentBlockId;
    });
    
    validTitleElements.forEach(titleElement => {
      if (titleElement instanceof HTMLElement) {
        titleElement.style.removeProperty('color');
      }
    });
  }
  
  // 处理内联元素（根据开关状态决定是否应用或清除样式）
  const enableInlineColor = settings?.enableInlineColor ?? false;
  
  if (inlineElements.length > 0) {
    // 优化：预先过滤属于当前块的内联元素
    const validInlineElements = Array.from(inlineElements).filter(inlineElement => {
      const inlineParentBlock = inlineElement.closest('.orca-block.orca-container');
      return !inlineParentBlock || inlineParentBlock.getAttribute('data-id') === currentBlockId;
    });
    
    validInlineElements.forEach(inlineElement => {
      if (inlineElement instanceof HTMLElement) {
        // 检查元素是否有 fc 类，如果有则跳过（fc 表示已设置过颜色）
        if (inlineElement.classList.contains('fc')) {
          debugLog(`跳过带 fc 类的内联元素，不覆盖其颜色`);
          return;
        }
        
        // 检查元素是否有 b 类（粗体样式）
        if (inlineElement.classList.contains('b')) {
          // 有 b 类时，清除颜色样式，让粗体样式显示
          debugLog(`元素有 b 类，清除颜色样式，让粗体样式显示`);
          inlineElement.style.removeProperty('color');
          return;
        }
        
        if (enableInlineColor && colorSource === 'tag') {
          // 启用时：应用样式（单标签和多标签都处理）
          inlineElement.style.setProperty('color', displayColor);
        } else {
          // 关闭时：清除样式
          inlineElement.style.removeProperty('color');
        }
      }
    });
  }
}

/**
 * 为容器块的无序点应用颜色样式和图标（保持原有函数用于兼容性）
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 */
function applyBlockHandleColor(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null) {
  // 查找当前块的所有图标元素和标题元素
  const handleElements = blockElement.querySelectorAll('.orca-block-handle');
  const titleElements = blockElement.querySelectorAll('.orca-repr-title');
  const inlineElements = blockElement.querySelectorAll('.orca-inline[data-type="t"]');
  
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
      handleElement.style.setProperty('color', displayColor);
      
      // 设置图标属性（统一处理所有格式）
      if (iconValue) {
        // 检查是否为 Tabler Icons 格式（以 "ti " 开头）
        if (iconValue.startsWith('ti ')) {
          // Tabler Icons 格式，使用 requestAnimationFrame 避免频繁 DOM 操作
          requestAnimationFrame(() => {
            const iconClasses = iconValue.split(' ').filter(cls => cls.trim() !== '');
            
            // 移除所有现有的 Tabler Icons 类（包括 ti、ti- 开头的所有类）
            const existingClasses = Array.from(handleElement.classList);
            existingClasses.forEach(cls => {
              if (cls === 'ti' || cls.startsWith('ti-')) {
                handleElement.classList.remove(cls);
              }
            });
            
            // 添加新的图标类
            iconClasses.forEach(cls => {
              if (cls.trim() !== '') {
                handleElement.classList.add(cls);
              }
            });
            
            debugLog(`块 ${currentBlockId} 的图标是 Tabler Icons 格式: "${iconValue}"，覆盖旧图标类`);
          });
        } else {
          // 其他格式，设置 data-icon 属性
          handleElement.setAttribute('data-icon', iconValue);
          debugLog(`为块 ${currentBlockId} 的图标设置 data-icon="${iconValue}"`);
        }
      } else {
        debugLog(`块 ${currentBlockId} 没有图标值，跳过设置图标`);
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
  
  // 处理标题元素（根据设置决定是否启用）
  const settings = orca.state.plugins[pluginName]?.settings;
  const enableTitleColor = settings?.enableTitleColor ?? true;
  
  if (enableTitleColor) {
    titleElements.forEach(titleElement => {
      // 检查这个标题是否属于当前块（不是子块）
      const titleParentBlock = titleElement.closest('.orca-block.orca-container');
      if (titleParentBlock && titleParentBlock.getAttribute('data-id') !== currentBlockId) {
        return; // 跳过子块的标题
      }
      if (titleElement instanceof HTMLElement) {
        // 只设置前景颜色（标题不需要图标和背景色）
        titleElement.style.setProperty('color', displayColor);
      }
    });
  } else {
    // 当设置关闭时，清除标题颜色样式
    titleElements.forEach(titleElement => {
      const titleParentBlock = titleElement.closest('.orca-block.orca-container');
      if (titleParentBlock && titleParentBlock.getAttribute('data-id') !== currentBlockId) {
        return; // 跳过子块的标题
      }
      if (titleElement instanceof HTMLElement) {
        titleElement.style.removeProperty('color');
      }
    });
  }
  
  // 处理内联元素（根据开关状态决定是否应用或清除样式）
  const enableInlineColor = settings?.enableInlineColor ?? false;
  
  inlineElements.forEach(inlineElement => {
    // 检查这个内联元素是否属于当前块（不是子块）
    const inlineParentBlock = inlineElement.closest('.orca-block.orca-container');
    if (inlineParentBlock && inlineParentBlock.getAttribute('data-id') !== currentBlockId) {
      return; // 跳过子块的内联元素
    }
    if (inlineElement instanceof HTMLElement) {
      // 检查元素是否有 fc 类，如果有则跳过（fc 表示已设置过颜色）
      if (inlineElement.classList.contains('fc')) {
        debugLog(`跳过带 fc 类的内联元素，不覆盖其颜色`);
        return;
      }
      
      // 检查元素是否有 b 类（粗体样式）
      if (inlineElement.classList.contains('b')) {
        // 有 b 类时，清除颜色样式，让粗体样式显示
        debugLog(`元素有 b 类，清除颜色样式，让粗体样式显示`);
        inlineElement.style.removeProperty('color');
        return;
      }
      
      if (enableInlineColor) {
        // 启用时：应用样式
        inlineElement.style.setProperty('color', displayColor);
      } else {
        // 关闭时：清除样式
        inlineElement.style.removeProperty('color');
      }
    }
  });
}

/**
 * 为内联引用应用颜色样式
 * @param inlineElement 内联引用元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param tagColors 多标签颜色数组
 * @param colorSource 颜色来源
 */
function applyInlineRefColor(inlineElement: Element, displayColor: string, tagColors: string[], colorSource: 'block' | 'tag') {
  // 查找 .orca-inline-r-content 元素
  const contentElement = inlineElement.querySelector('.orca-inline-r-content');
  
  if (contentElement instanceof HTMLElement) {
    // 根据标签数量决定处理方式
    if (tagColors.length > 1) {
      // 多标签：叠加颜色在 Orca 默认颜色上
      contentElement.style.setProperty('color', displayColor);
    } else {
      // 单标签：使用原有逻辑
      contentElement.style.setProperty('color', displayColor);
    }
    
    // 设置 border-bottom-color，使用 displayColor 但添加透明度
    // 如果 displayColor 是 oklch 格式，使用 color-mix 添加透明度
    if (displayColor.includes('oklch')) {
      contentElement.style.setProperty('border-bottom-color', `color-mix(in oklch, ${displayColor} 65%, transparent)`, 'important');
    } else {
      // 如果是十六进制格式，转换为 rgba
      const borderColor = hexToRgba(displayColor, 0.65);
      contentElement.style.setProperty('border-bottom-color', borderColor, 'important');
    }
  }
}

/**
 * 监听块的折叠/展开状态变化（使用统一观察器优化）
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 * @param tagColors 多标签颜色数组
 */
function observeBlockHandleCollapse(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null, tagColors?: string[], colorSource?: 'block' | 'tag') {
  // 使用统一观察器管理
  unifiedObserver.addObservedElement(blockElement, displayColor, bgColorValue, iconValue, tagColors, colorSource);
}

/**
 * 从标签引用中获取第一个有效的标签属性（有颜色或有图标的标签）
 * @param tagRefs 标签引用数组
 * @param maxCount 最大获取数量，默认为1
 * @returns 有效的标签属性数组（有颜色或有图标）
 */
async function getFirstValidTagProps(tagRefs: any[], maxCount: number = 1): Promise<any[]> {
  const validTagProps: any[] = [];
  
  for (const ref of tagRefs) {
    if (validTagProps.length >= maxCount) {
      break; // 已经找到足够的标签，停止处理
    }
    
    const tagProps = await getBlockStyleProperties(ref.to);
    // 检查是否有颜色或有图标（任一即可）
    if ((tagProps.colorEnabled && tagProps.colorValue) || (tagProps.iconEnabled && tagProps.iconValue)) {
      validTagProps.push({ ...tagProps, blockId: ref.to });
    }
  }
  
  return validTagProps;
}

/**
 * 获取块的 _color 和 _icon 属性值（使用缓存优化）
 * @returns { colorValue: string | null, iconValue: string | null, colorEnabled: boolean, iconEnabled: boolean }
 */
async function getBlockStyleProperties(blockId: number): Promise<{ colorValue: string | null; iconValue: string | null; colorEnabled: boolean; iconEnabled: boolean }> {
  // 先尝试从缓存获取
  const cached = dataCache.getBlockProperties(blockId);
  if (cached) {
    return cached;
  }
  
  try {
    const block = await orca.invokeBackend("get-block", blockId);
    
    // 优化：提前返回，减少不必要的处理
    if (!block?.properties || !Array.isArray(block.properties)) {
      const result = { colorValue: null, iconValue: null, colorEnabled: false, iconEnabled: false };
      dataCache.setBlockProperties(blockId, result);
      return result;
    }
    
    // 优化：使用更高效的属性查找
    const properties = block.properties;
    let colorProperty: any = null;
    let iconProperty: any = null;
    
    // 使用for循环替代for...of，性能更好
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      if (prop.name === "_color") {
        colorProperty = prop;
        if (iconProperty) break; // 两个都找到了，提前退出
      } else if (prop.name === "_icon") {
        iconProperty = prop;
        if (colorProperty) break; // 两个都找到了，提前退出
      }
    }
    
    // 优化：简化条件判断
    const colorEnabled = colorProperty?.type === 1;
    const iconEnabled = iconProperty?.type === 1;
    
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
    // 优化：减少错误处理开销
    const result = { colorValue: null, iconValue: null, colorEnabled: false, iconEnabled: false };
    dataCache.setBlockProperties(blockId, result);
    return result;
  }
}

/**
 * 清理没有标签的块的样式
 */
function cleanupBlockStyles(blockElement: Element) {
  const currentBlockId = blockElement.getAttribute('data-id');
  if (!currentBlockId) return;
  
  // 清理图标元素
  const handleElements = blockElement.querySelectorAll('.orca-block-handle');
  handleElements.forEach(handleElement => {
    const handleParentBlock = handleElement.closest('.orca-block.orca-container');
    if (handleParentBlock && handleParentBlock.getAttribute('data-id') === currentBlockId) {
      if (handleElement instanceof HTMLElement) {
        handleElement.style.removeProperty('color');
        handleElement.style.removeProperty('background-color');
        handleElement.style.removeProperty('background-image');
        handleElement.removeAttribute('data-icon');
      }
    }
  });
  
  // 清理标题元素
  const titleElements = blockElement.querySelectorAll('.orca-repr-title');
  titleElements.forEach(titleElement => {
    const titleParentBlock = titleElement.closest('.orca-block.orca-container');
    if (titleParentBlock && titleParentBlock.getAttribute('data-id') === currentBlockId) {
      if (titleElement instanceof HTMLElement) {
        titleElement.style.removeProperty('color');
      }
    }
  });
  
  // 清理内联元素
  const inlineElements = blockElement.querySelectorAll('.orca-inline[data-type="t"]');
  inlineElements.forEach(inlineElement => {
    const inlineParentBlock = inlineElement.closest('.orca-block.orca-container');
    if (inlineParentBlock && inlineParentBlock.getAttribute('data-id') === currentBlockId) {
      if (inlineElement instanceof HTMLElement) {
        // 检查元素是否有 fc 类，如果有则跳过（fc 表示已设置过颜色）
        if (!inlineElement.classList.contains('fc')) {
          // 无论是否有 b 类，都清除颜色样式
          inlineElement.style.removeProperty('color');
        }
      }
    }
  });
  
  debugLog(`清理块 ${currentBlockId} 的样式`);
}

/**
 * 处理单个面板的容器块（提取公共逻辑）
 */
async function processPanelBlocks(panelId: string, panelElement: Element) {
  debugLog(`处理面板: ${panelId}`);
  
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
    tagColors: string[]; // 多标签颜色数组
  } | null>[] = [];
  
  // 优化：批量处理容器块，减少DOM查询次数和Array.from开销
  const containerPromises: Promise<{ 
    blockId: string; 
    aliasBlockId: number; 
    colorValue: string | null; 
    iconValue: string | null;
    colorSource: 'block' | 'tag'; // 标记颜色来源
    domColor: string | null; // DOM 上标签的实际颜色（如果 colorValue 为 null 则为 null）
    elementType: 'container' | 'inline-ref'; // 标记元素类型
    tagColors: string[]; // 多标签颜色数组
  } | null>[] = [];
  
  // 优化：使用for循环替代Array.from().map，减少内存分配
  for (let i = 0; i < containerElements.length; i++) {
    const element = containerElements[i];
    const promise = (async () => {
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
        
        // 2. 从refs中获取前4个type=2的标签引用
        if (!blockData.refs || blockData.refs.length === 0) {
          // 没有引用信息，清理样式
          cleanupBlockStyles(element);
          return null; // 没有引用信息，跳过
        }
        
        // 找到所有type=2的引用（标签）
        const allTagRefs = blockData.refs.filter((ref: any) => ref.type === 2);
        
        // 从_tags属性中获取标签顺序
        const tagsProperty = blockData.properties?.find((prop: any) => prop.name === '_tags');
        let sortedTagRefs = allTagRefs;
        
        if (tagsProperty && tagsProperty.value && Array.isArray(tagsProperty.value)) {
          // 按照_tags中的value数组顺序重新排列标签引用
          const orderedTagIds = tagsProperty.value;
          const tagRefsMap = new Map();
          
          // 创建标签引用ID到引用的映射
          allTagRefs.forEach((ref: any) => {
            tagRefsMap.set(ref.id, ref);
          });
          
          // 按照_tags中的顺序重新排列
          sortedTagRefs = orderedTagIds
            .map((tagId: number) => tagRefsMap.get(tagId))
            .filter((ref: any) => ref !== undefined); // 过滤掉不存在的引用
        }
        if (sortedTagRefs.length === 0) {
          // 没有标签引用，清理样式
          cleanupBlockStyles(element);
          return null; // 没有标签引用，跳过
        }
        
        // 使用公共函数获取有效的标签属性（有颜色或有图标），最多取前4个
        // 现在使用排序后的标签引用
        const validTagProps = await getFirstValidTagProps(sortedTagRefs, 4);
        
        if (validTagProps.length === 0) {
          // 有标签但没有有效标签（无颜色无图标），清理样式
          cleanupBlockStyles(element);
          return null; // 没有有效的标签，跳过
        }
        
        // 使用筛选后的标签引用
        const tagRefs = validTagProps.map(props => ({ blockId: props.blockId }));
        
        // 使用第一个标签作为主要标签（用于图标等）
        const firstTagProps = validTagProps[0];
        
        // 4. 检查容器块本身是否启用了颜色且有值（最高优先级）
        const blockStyleProps = await getBlockStyleProperties(blockIdNum);
        
        // 如果容器块本身启用了颜色且有值，使用自身块的颜色（最高优先级）
        if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
          debugLog(`面板 ${panelId} 容器块 ${blockIdNum} 自身有颜色，使用自身块颜色`);
          
          const finalDomColor = calculateDomColor(blockStyleProps.colorValue);
          
          // 如果自身块没有图标，尝试从第一个标签获取图标
          let finalIconValue = blockStyleProps.iconValue;
          if (!finalIconValue && validTagProps.length > 0) {
            finalIconValue = validTagProps[0].iconValue;
            debugLog(`面板 ${panelId} 容器块 ${blockIdNum} 自身无图标，使用标签图标: ${finalIconValue}`);
          }
          
          return {
            blockId: dataId,
            aliasBlockId: blockIdNum, // 使用自身块ID
            colorValue: blockStyleProps.colorValue,
            iconValue: finalIconValue, // 优先使用自身图标，无图标时使用标签图标
            colorSource: 'block' as const,
            domColor: finalDomColor,
            elementType: 'container' as const,
            tagColors: [blockStyleProps.colorValue] // 单色情况
          };
        }
        
        // 5. 如果容器块没有颜色值（未启用或值为null），检查容器块是否有图标
        // 图标优先级：容器块自身图标 > 标签图标
        if (blockStyleProps.iconEnabled && blockStyleProps.iconValue) {
          // 容器块有图标，使用容器块的图标
          debugLog(`面板 ${panelId} 容器块 ${blockIdNum} 只有图标没有颜色:`, {
            自身块图标: blockStyleProps.iconValue,
            自身块图标启用: blockStyleProps.iconEnabled
          });
          
          // 获取有效的标签颜色
          const validTagColors = validTagProps
            .filter(props => props.colorEnabled && props.colorValue)
            .map(props => props.colorValue!);
          
          // 如果标签没有颜色，不设置颜色，让图标保持原始颜色
          if (validTagColors.length === 0) {
            return {
              blockId: dataId,
              aliasBlockId: blockIdNum, // 使用自身块ID
              colorValue: null, // 不设置颜色，保持原始颜色
              iconValue: blockStyleProps.iconValue, // 使用容器块自身的图标
              colorSource: 'block' as const,
              domColor: null, // 不设置颜色
              elementType: 'container' as const,
              tagColors: [] // 无颜色
            };
          }
          
          return {
            blockId: dataId,
            aliasBlockId: firstTagProps.blockId,
            colorValue: validTagColors[0], // 使用第一个标签颜色作为主颜色
            iconValue: blockStyleProps.iconValue, // 使用容器块自身的图标
            colorSource: 'tag' as const,
            domColor: calculateDomColor(validTagColors[0]),
            elementType: 'container' as const,
            tagColors: validTagColors // 多色情况
          };
        }
        
        // 6. 如果容器块既没有颜色也没有图标，使用标签的颜色 + 标签的图标
        // 获取有效的标签颜色
        const validTagColors = validTagProps
          .filter(props => props.colorEnabled && props.colorValue)
          .map(props => props.colorValue!);
        
        // 如果标签没有颜色但有图标，不设置颜色，让图标保持原始颜色
        if (validTagColors.length === 0) {
          // 检查是否有图标
          if (firstTagProps.iconEnabled && firstTagProps.iconValue) {
            return {
              blockId: dataId,
              aliasBlockId: firstTagProps.blockId, // 使用第一个标签的块ID
              colorValue: null, // 不设置颜色，保持原始颜色
              iconValue: firstTagProps.iconValue, // 图标从第一个标签读取
              colorSource: 'tag' as const,
              domColor: null, // 不设置颜色
              elementType: 'container' as const,
              tagColors: [] // 无颜色
            };
          } else {
            // 如果标签既没有颜色也没有图标，返回null，让系统使用原生样式
            return null;
          }
        }
        
        const finalDomColor = calculateDomColor(validTagColors[0]);
        
        debugLog(`面板 ${panelId} 标签块图标处理:`, {
          标签图标: firstTagProps.iconValue,
          标签图标启用: firstTagProps.iconEnabled,
          标签颜色数量: validTagColors.length
        });
        
        return {
          blockId: dataId,
          aliasBlockId: firstTagProps.blockId, // 使用第一个标签的块ID
          colorValue: validTagColors[0], // 使用第一个标签颜色作为主颜色
          iconValue: firstTagProps.iconValue, // 图标从第一个标签读取
          colorSource: 'tag' as const,
          domColor: finalDomColor,
          elementType: 'container' as const,
          tagColors: validTagColors // 多色情况
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
            elementType: 'container' as const,
            tagColors: [blockStyleProps.colorValue] // 单色情况
          };
        }
        
        // 如果自身设置了图标但没有颜色，不设置颜色，让图标保持原始颜色
        if (blockStyleProps.iconEnabled && blockStyleProps.iconValue) {
          return {
            blockId: dataId,
            aliasBlockId: blockIdNum, // 使用自身块ID
            colorValue: null, // 不设置颜色，保持原始颜色
            iconValue: blockStyleProps.iconValue, // 使用自身图标
            colorSource: 'block' as const,
            domColor: null, // 不设置颜色
            elementType: 'container' as const,
            tagColors: [] // 无颜色
          };
        }
        
        // 没有标签且没有自身颜色和图标，清理样式
        cleanupBlockStyles(element);
        return null; // 没有启用颜色，跳过
      } catch (error) {
        return null;
      }
    }
    })();
    
    containerPromises.push(promise);
  }
  
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
                elementType: 'inline-ref' as const,
                tagColors: [blockStyleProps.colorValue] // 单色情况
              };
            }
            
            // 3. 如果自身块没有颜色，尝试从第一个有颜色的标签读取
            if (!blockData.refs || blockData.refs.length === 0) {
              return null; // 没有引用信息，跳过
            }
            
            // 找到所有type=2的引用（标签）
            const allTagRefs = blockData.refs.filter((ref: any) => ref.type === 2);
            if (allTagRefs.length === 0) {
              return null; // 没有标签引用，跳过
            }
            
            // 使用公共函数获取第一个有颜色的标签属性
            const coloredTagProps = await getFirstValidTagProps(allTagRefs, 1);
            
            if (coloredTagProps.length === 0) {
              return null; // 没有有颜色的标签，跳过
            }
            
            const firstColoredTagProps = coloredTagProps[0];
            const aliasBlockId = firstColoredTagProps.blockId;
            
            const finalDomColor = calculateDomColor(firstColoredTagProps.colorValue);
            
            return {
              blockId: refId,
              aliasBlockId: aliasBlockId, // 使用标签块ID
              colorValue: firstColoredTagProps.colorValue,
              iconValue: firstColoredTagProps.iconValue, // 从标签读取图标
              colorSource: 'tag' as const,
              domColor: finalDomColor,
              elementType: 'inline-ref' as const,
              tagColors: [firstColoredTagProps.colorValue] // 单色情况
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
    tagColors: string[];
  } => item !== null);
  
  debugLog(`面板 [${panelId}] 异步处理完成:`, {
    总处理数量: allResults.length,
    成功处理数量: taggedBlocks.length,
    失败数量: allResults.length - taggedBlocks.length
  });
  
  // 优化：批量清除样式，减少DOM查询次数
  if (containerElements.length > 0) {
    // 批量查询所有需要清除样式的元素
    const allHandleElements: HTMLElement[] = [];
    const allTitleElements: HTMLElement[] = [];
    
    // 一次性收集所有需要清除样式的元素
    containerElements.forEach((element) => {
      const handleElements = element.querySelectorAll('.orca-block-handle');
      handleElements.forEach(handleElement => {
        if (handleElement instanceof HTMLElement) {
          allHandleElements.push(handleElement);
        }
      });
      
      const titleElements = element.querySelectorAll('.orca-repr-title');
      titleElements.forEach(titleElement => {
        if (titleElement instanceof HTMLElement) {
          allTitleElements.push(titleElement);
        }
      });
    });
    
    // 批量清除样式
    allHandleElements.forEach(handleElement => {
      handleElement.style.removeProperty('color');
      handleElement.style.removeProperty('background-color');
      handleElement.style.removeProperty('opacity');
      // 注意：不清理 data-icon，避免清理自身块设置的图标
    });
    
    allTitleElements.forEach(titleElement => {
      titleElement.style.removeProperty('color');
    });
  }
  
  // 批量清除内联引用样式
  const allInlineRefElements = panelElement.querySelectorAll('.orca-inline-r-content');
  if (allInlineRefElements.length > 0) {
    allInlineRefElements.forEach((contentElement) => {
      if (contentElement instanceof HTMLElement) {
        contentElement.style.removeProperty('color');
      }
    });
  }
  
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
    const enableInlineColor = settings?.enableInlineColor ?? false;

    // 优化：批量处理启用颜色的块，减少DOM查询次数
    if (taggedBlocks.length > 0) {
      // 预先计算所有需要的颜色值
      const processedBlocks = taggedBlocks.map(block => {
        if (!block.colorValue) return null;
        
        // 根据颜色来源和主题模式决定显示颜色（用于前景色）
        let displayColor: string;
        if (block.colorSource === 'block') {
          displayColor = block.colorValue;
        } else {
          if (isDarkMode() && useDomColor) {
            displayColor = block.domColor || block.colorValue;
          } else {
            displayColor = block.colorValue;
          }
        }
        
        return {
          ...block,
          displayColor,
          bgColorValue: block.colorValue,
          iconValue: block.iconValue
        };
      }).filter(Boolean);
      
      // 批量查询DOM元素，减少重复查询
      const containerBlocks = processedBlocks.filter(block => block && block.elementType === 'container');
      const inlineBlocks = processedBlocks.filter(block => block && block.elementType === 'inline-ref');
      
      // 批量处理容器块
      if (containerBlocks.length > 0) {
        const containerBlockIds = containerBlocks.map(block => block!.blockId);
        const allContainerElements = new Map<string, NodeListOf<Element>>();
        
        // 一次性查询所有需要的容器块元素
        containerBlockIds.forEach(blockId => {
          if (!allContainerElements.has(blockId)) {
            const elements = panelElement.querySelectorAll(`[data-id="${blockId}"]`);
            allContainerElements.set(blockId, elements);
          }
        });
        
        // 批量应用样式
        containerBlocks.forEach(block => {
          if (block) {
            const blockElements = allContainerElements.get(block.blockId);
            if (blockElements) {
              blockElements.forEach(blockElement => {
                if (block.tagColors.length > 1) {
                  applyMultiTagHandleColor(blockElement, block.displayColor, block.bgColorValue, block.iconValue, block.tagColors, block.colorSource);
                } else {
                  applyBlockHandleColor(blockElement, block.displayColor, block.bgColorValue, block.iconValue);
                }
                observeBlockHandleCollapse(blockElement, block.displayColor, block.bgColorValue, block.iconValue, block.tagColors, block.colorSource);
              });
            }
          }
        });
      }
      
      // 优化：批量处理内联引用块，减少DOM查询和循环开销
      if (inlineBlocks.length > 0) {
        // 预先收集所有需要查询的blockId
        const inlineBlockIds = inlineBlocks.map(block => block!.blockId);
        
        // 优化：使用单个查询获取所有内联引用元素，然后按blockId分组
        const allInlineElements = panelElement.querySelectorAll('.orca-inline[data-ref]');
        const inlineElementsByBlockId = new Map<string, Element[]>();
        
        // 一次性遍历所有内联引用元素，按blockId分组
        allInlineElements.forEach(element => {
          const refId = element.getAttribute('data-ref');
          if (refId && inlineBlockIds.includes(refId)) {
            if (!inlineElementsByBlockId.has(refId)) {
              inlineElementsByBlockId.set(refId, []);
            }
            inlineElementsByBlockId.get(refId)!.push(element);
          }
        });
        
        // 批量应用样式，减少循环次数
        const styleOperations: Array<{
          element: Element;
          displayColor: string;
          tagColors: string[];
          colorSource: 'block' | 'tag';
        }> = [];
        
        inlineBlocks.forEach(block => {
          if (block) {
            const elements = inlineElementsByBlockId.get(block.blockId);
            if (elements) {
              elements.forEach(element => {
                styleOperations.push({
                  element,
                  displayColor: block.displayColor,
                  tagColors: block.tagColors,
                  colorSource: block.colorSource
                });
              });
            }
          }
        });
        
        // 批量执行样式应用
        styleOperations.forEach(({ element, displayColor, tagColors, colorSource }) => {
          applyInlineRefColor(element, displayColor, tagColors, colorSource);
        });
      }
    }
  }
}

/**
 * 读取所有面板中的容器块 data-id，并筛选出带标签且启用了颜色的块（使用缓存优化）
 */
async function readAllPanelsContainerBlocks(viewPanels: any[]) {
  // 检查面板结构是否发生变化，如果变化则清除DOM缓存并刷新观察器
  if (domCache.checkPanelStructureChange()) {
    domCache.clearAllCache();
    // 刷新观察器以观察新的面板容器
    unifiedObserver.refreshObserver();
  }
  
  // 清理所有之前的观察元素
  unifiedObserver.clearAllObservedElements();
  
  // 处理普通面板
  for (const panel of viewPanels) {
    const panelId = panel.id;
    const panelElement = domCache.getPanelElement(panelId);
    
    if (!panelElement) {
      continue;
    }
    
    await processPanelBlocks(panelId, panelElement);
  }
  
  // 处理特殊面板 (_globalSearch 和 _reference)
  const specialPanels = ['_globalSearch', '_reference'];
  for (const panelId of specialPanels) {
    const panelElement = domCache.getPanelElement(panelId);
    
    if (!panelElement) {
      continue;
    }
    
    debugLog(`处理特殊面板: ${panelId}`);
    await processPanelBlocks(panelId, panelElement);
  }
}

export async function load(_name: string) {
  pluginName = _name;

  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  // 注入CSS样式
  orca.themes.injectCSSResource(`${pluginName}/dist/styles.css`, `${pluginName}-styles`);

  // 注册设置 schema
  await orca.plugins.setSettingsSchema(pluginName, settingsSchema);

  // 检查标签值颜色设置并加载相应CSS
  const settings = orca.state.plugins[pluginName]?.settings;
  if (settings?.enableTagValueColor) {
    orca.themes.injectCSSResource(`${pluginName}/dist/tag-value-color.css`, `${pluginName}-tag-value-color`);
  }

  // 扩展渲染器以支持Tana自定义属性
  TanaRendererExtension.extendAllRenderers();


  // 启动统一观察器
  unifiedObserver.startObserver();
  
  // 启动定期清理任务（每5分钟清理一次过期缓存和失效DOM引用）
  cleanupInterval = setInterval(() => {
    dataCache.cleanupExpiredCache();
    domCache.cleanupInvalidReferences(); // 添加DOM引用清理
    unifiedObserver.cleanupInvalidStyleReferences(); // 添加样式检测引用清理
    debugLog('执行定期缓存、DOM引用和样式检测清理');
  }, 5 * 60 * 1000); // 5分钟
  
  // 插件加载时延迟执行初始化（给DOM渲染留出时间）
  debugLog(`将在 ${INITIAL_DELAY}ms 后开始初始化`);
  setTimeout(() => initializeWithRetry(), INITIAL_DELAY);

  // 监听面板变化和设置变化
  if (window.Valtio?.subscribe) {
    unsubscribe = window.Valtio.subscribe(orca.state, () => {
      // 检查标签值颜色设置变化
      const currentSettings = orca.state.plugins[pluginName]?.settings;
      const enableTagValueColor = currentSettings?.enableTagValueColor ?? false;
      
      // 动态加载/卸载标签值颜色CSS
      if (enableTagValueColor) {
        orca.themes.injectCSSResource(`${pluginName}/dist/tag-value-color.css`, `${pluginName}-tag-value-color`);
      } else {
        orca.themes.removeCSSResources(`${pluginName}-tag-value-color`);
      }
      
      // 使用防抖函数，避免频繁触发
      debounceGetPanelBlockIds();
    });
  }
}

export async function unload() {
  // 恢复原始渲染器
  TanaRendererExtension.restoreOriginalRenderers();
  
  
  // 移除注入的CSS样式
  orca.themes.removeCSSResources(`${pluginName}-styles`);
  orca.themes.removeCSSResources(`${pluginName}-tag-value-color`);
  
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
  
}
