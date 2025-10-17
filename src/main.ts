import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";

let pluginName: string;
let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
 * 递归遍历面板结构，收集所有 ViewPanel
 */
function collectViewPanels(panel: any): any[] {
  const viewPanels: any[] = [];
  
  if (!panel) return viewPanels;
  
  // 如果是 ViewPanel（有 view 属性）
  if (panel.view) {
    viewPanels.push(panel);
  }
  
  // 如果有 children，递归遍历
  if (panel.children && Array.isArray(panel.children)) {
    for (const child of panel.children) {
      viewPanels.push(...collectViewPanels(child));
    }
  }
  
  return viewPanels;
}

/**
 * 防抖执行函数
 */
function debounceGetPanelBlockIds() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    // 使用 requestAnimationFrame 优化渲染，避免闪烁
    requestAnimationFrame(async () => {
      await getAllPanelBlockIds();
    });
  }, 100); // 100ms 防抖延迟（降低延迟以提高响应速度）
}

/**
 * 获取所有面板的块ID
 */
async function getAllPanelBlockIds() {
  const panels = orca.state.panels;
  const viewPanels = collectViewPanels(panels);
  const blockIds: number[] = [];
  
  for (const panel of viewPanels) {
    try {
      if (panel.view === "block") {
        // block 类型面板，直接获取 blockId
        const blockId = panel.viewArgs?.blockId;
        if (blockId != null) {
          blockIds.push(blockId);
        }
      } else if (panel.view === "journal") {
        // journal 类型面板，通过日期获取 journal block
        const date = panel.viewArgs?.date;
        if (date) {
          const journalBlock = await orca.invokeBackend("get-journal-block", new Date(date));
          if (journalBlock?.id != null) {
            blockIds.push(journalBlock.id);
          }
        }
      }
    } catch (error) {
      debugError(`获取面板块ID失败:`, error);
    }
  }
  
    debugLog("所有面板的块ID:", blockIds);

    // 读取所有面板的容器块元素
    await readAllPanelsContainerBlocks(viewPanels);
  
  return blockIds;
}

/**
 * 检查DOM是否准备好
 * @returns 是否有至少一个面板的DOM元素存在
 */
function isDOMReady(): boolean {
  const panels = orca.state.panels;
  const viewPanels = collectViewPanels(panels);
  
  // 检查是否至少有一个面板的DOM元素存在
  for (const panel of viewPanels) {
    const panelElement = document.querySelector(`[data-panel-id="${panel.id}"]`);
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
  // 查找 .orca-block-handle.ti.ti-point-filled 和 .orca-block-handle.ti.ti-photo 元素
  const handleElements = blockElement.querySelectorAll('.orca-block-handle.ti.ti-point-filled, .orca-block-handle.ti.ti-photo');
  
  handleElements.forEach(handleElement => {
    if (handleElement instanceof HTMLElement) {
      // 设置前景颜色（可能是 domColor 或 colorValue）
      handleElement.style.setProperty('color', displayColor, 'important');
      
      // 设置图标属性
      if (iconValue) {
        handleElement.setAttribute('data-icon', iconValue);
      } else {
        handleElement.removeAttribute('data-icon');
      }
      
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
 * 监听块的折叠/展开状态变化
 * @param blockElement 容器块元素
 * @param displayColor 显示颜色（用于 color 属性）
 * @param bgColorValue 背景颜色基础值（用于 background-color 属性）
 * @param iconValue 图标值
 */
function observeBlockHandleCollapse(blockElement: Element, displayColor: string, bgColorValue: string, iconValue: string | null) {
  // 如果已经有观察器，先断开
  const existingObserver = (blockElement as any).__colorObserver;
  if (existingObserver) {
    existingObserver.disconnect();
  }
  
  // 创建 MutationObserver 监听整个容器块的变化
  const observer = new MutationObserver(() => {
    // 重新应用颜色样式和图标（因为 DOM 可能已经重新渲染）
    applyBlockHandleColor(blockElement, displayColor, bgColorValue, iconValue);
  });
  
  // 监听容器块的属性变化和子树变化
  observer.observe(blockElement, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true, // 监听所有子元素
    childList: true // 监听子元素的添加/删除
  });
  
  // 将 observer 存储在容器元素上
  (blockElement as any).__colorObserver = observer;
}

/**
 * 获取块的 _color 和 _icon 属性值
 * @returns { colorValue: string | null, iconValue: string | null, colorEnabled: boolean }
 */
async function getBlockStyleProperties(blockId: number): Promise<{ colorValue: string | null; iconValue: string | null; colorEnabled: boolean }> {
  try {
    const block = await orca.invokeBackend("get-block", blockId);
    
    if (!block || !block.properties || !Array.isArray(block.properties)) {
      return { colorValue: null, iconValue: null, colorEnabled: false };
    }
    
    // 查找 name="_color" 的属性
    const colorProperty = block.properties.find(
      (prop: any) => prop.name === "_color"
    );
    
    // 查找 name="_icon" 的属性
    const iconProperty = block.properties.find(
      (prop: any) => prop.name === "_icon"
    );
    
    // 检查颜色是否启用（type === 1）
    const colorEnabled = colorProperty && colorProperty.type === 1;
    
    return {
      colorValue: colorEnabled ? (colorProperty.value || null) : null,
      iconValue: iconProperty?.value || null,
      colorEnabled: !!colorEnabled
    };
  } catch (error) {
    return { colorValue: null, iconValue: null, colorEnabled: false };
  }
}

/**
 * 读取所有面板中的容器块 data-id，并筛选出带标签且启用了颜色的块
 */
async function readAllPanelsContainerBlocks(viewPanels: any[]) {
  // 先断开所有之前创建的 MutationObserver
  const panels = orca.state.panels;
  const allViewPanels = collectViewPanels(panels);
  
  for (const panel of allViewPanels) {
    const panelId = panel.id;
    const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`);
    
    if (!panelElement) {
      continue;
    }
    
    const containerElements = panelElement.querySelectorAll('.orca-block.orca-container');
    containerElements.forEach((element) => {
      const existingObserver = (element as any).__colorObserver;
      if (existingObserver) {
        existingObserver.disconnect();
        delete (element as any).__colorObserver;
      }
    });
  }
  
  for (const panel of viewPanels) {
    const panelId = panel.id;
    
    // 查找该面板的 DOM 元素
    const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`);
    
    if (!panelElement) {
      continue;
    }
    
    // 在该面板内查询所有容器块元素
    const containerElements = panelElement.querySelectorAll('.orca-block.orca-container');
    
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
    
    containerElements.forEach((element) => {
      // 查找该容器块下的 .orca-repr-main 元素
      const reprMainElement = element.querySelector('.orca-repr-main');
      
      if (reprMainElement) {
        const dataId = element.getAttribute('data-id');
        if (!dataId) return;
        
        // 检查 .orca-repr-main 下是否有 .orca-tags
        const tagsElement = reprMainElement.querySelector('.orca-tags');
        const hasTags = tagsElement && tagsElement.querySelector('.orca-tag');
        
        if (hasTags) {
          // 有标签的情况：使用标签处理逻辑
          const promise = (async () => {
            try {
              const blockIdNum = parseInt(dataId, 10);
              
              // 1. 获取块的完整信息（包含refs）
              const blockData = await orca.invokeBackend("get-block", blockIdNum);
              
              // 2. 从refs中获取aliasBlockId
              if (!blockData.refs || blockData.refs.length === 0) {
                return null; // 没有引用信息，跳过
              }
              
              const firstRef = blockData.refs[0];
              const aliasBlockId = firstRef.to;
              
              if (!aliasBlockId) {
                return null; // 引用信息不完整，跳过
              }
              
              // 3. 获取标签的属性（用于读取图标，可能还需要读取颜色）
              const tagStyleProps = await getBlockStyleProperties(aliasBlockId);
              
              // 4. 检查容器块本身是否启用了颜色且有值（最高优先级）
              const blockStyleProps = await getBlockStyleProperties(blockIdNum);
              
              // 如果容器块本身启用了颜色且有值，使用容器块的颜色 + 标签的图标
              if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
                const finalDomColor = calculateDomColor(blockStyleProps.colorValue);
                
                return {
                  blockId: dataId,
                  aliasBlockId: aliasBlockId, // 使用从refs获取的块ID
                  colorValue: blockStyleProps.colorValue,
                  iconValue: tagStyleProps.iconValue, // 图标从标签读取
                  colorSource: 'block' as const,
                  domColor: finalDomColor,
                  elementType: 'container' as const
                };
              }
              
              // 5. 如果容器块没有颜色值（未启用或值为null），使用标签的颜色 + 标签的图标
              if (!tagStyleProps.colorEnabled || !tagStyleProps.colorValue) {
                return null; // 标签也未启用颜色或没有颜色值，跳过
              }
              
              const finalDomColor = calculateDomColor(tagStyleProps.colorValue);
              
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
          })();
          
          taggedBlocksPromises.push(promise);
        } else {
          // 没有标签的情况：检查是否自身设置了_color
          const promise = (async () => {
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
          })();
          
          taggedBlocksPromises.push(promise);
        }
      }
    });
    
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
                
                return {
                  blockId: refId,
                  aliasBlockId: blockIdNum, // 使用自身块ID
                  colorValue: blockStyleProps.colorValue,
                  iconValue: blockStyleProps.iconValue, // 从自身读取图标
                  colorSource: 'block' as const,
                  domColor: finalDomColor,
                  elementType: 'inline-ref' as const
                };
              }
              
              // 3. 如果自身块没有颜色，尝试从第一个标签读取
              if (!blockData.refs || blockData.refs.length === 0) {
                return null; // 没有引用信息，跳过
              }
              
              const firstRef = blockData.refs[0];
              const aliasBlockId = firstRef.to;
              
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
    
    // 先清除当前面板的所有容器块样式
    const allContainerElements = panelElement.querySelectorAll('.orca-block.orca-container');
    allContainerElements.forEach((element) => {
      const handleElements = element.querySelectorAll('.orca-block-handle.ti.ti-point-filled, .orca-block-handle.ti.ti-photo');
      handleElements.forEach(handleElement => {
        if (handleElement instanceof HTMLElement) {
          handleElement.style.removeProperty('color');
          handleElement.style.removeProperty('background-color');
          handleElement.style.removeProperty('opacity');
          handleElement.removeAttribute('data-icon');
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
    
    // 只输出启用了颜色的容器块（包含块ID、标签名、别名块ID、颜色值、图标值和DOM颜色）
    if (taggedBlocks.length > 0) {
      debugLog(`当前面板 [${panelId}] 的启用颜色的容器块:`, taggedBlocks);
      
      // 显示启用颜色的容器块的引用信息
      for (const block of taggedBlocks) {
        try {
          const blockIdNum = parseInt(block.blockId, 10);
          const blockData = await orca.invokeBackend("get-block", blockIdNum);
          debugLog(`启用颜色的容器块 ${block.blockId} 的引用信息:`, {
            refs: blockData.refs,
            backRefs: blockData.backRefs
          });
        } catch (error) {
          debugError(`获取块 ${block.blockId} 引用信息失败:`, error);
        }
      }
      
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
  
  // 清理防抖定时器
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  
  // 取消状态监听
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  
  // 清理注册的命令
  orca.commands.unregisterCommand(`${pluginName}.getAllPanelBlockIds`);
}
