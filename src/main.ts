import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";

let pluginName: string;
let unsubscribe: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastPanelsSnapshot: string = "";

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
    // 检查面板是否真的变化了
    const currentSnapshot = JSON.stringify(orca.state.panels);
    if (currentSnapshot !== lastPanelsSnapshot) {
      lastPanelsSnapshot = currentSnapshot;
      await getAllPanelBlockIds();
    }
  }, 300); // 300ms 防抖延迟
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
      console.error(`获取面板块ID失败:`, error);
    }
  }
  
  console.log("所有面板的块ID:", blockIds);
  
  // 读取所有面板的容器块元素
  await readAllPanelsContainerBlocks(viewPanels);
  
  return blockIds;
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
 */
function applyBlockHandleColor(blockElement: Element, colorValue: string, iconValue: string | null) {
  // 查找 .orca-block-handle.ti.ti-point-filled 元素
  const handleElement = blockElement.querySelector('.orca-block-handle.ti.ti-point-filled');
  
  if (handleElement instanceof HTMLElement) {
    // 设置无序点颜色
    handleElement.style.setProperty('color', colorValue, 'important');
    
    // 设置图标属性
    if (iconValue) {
      handleElement.setAttribute('data-icon', iconValue);
    } else {
      handleElement.removeAttribute('data-icon');
    }
    
    // 如果有 orca-block-handle-collapsed 类，设置背景颜色（透明度 0.45）
    if (handleElement.classList.contains('orca-block-handle-collapsed')) {
      const bgColor = hexToRgba(colorValue, 0.45);
      handleElement.style.setProperty('background-color', bgColor, 'important');
    } else {
      // 没有折叠类时，清除背景颜色
      handleElement.style.removeProperty('background-color');
    }
  }
}

/**
 * 监听块的折叠/展开状态变化
 */
function observeBlockHandleCollapse(blockElement: Element, colorValue: string, iconValue: string | null) {
  const handleElement = blockElement.querySelector('.orca-block-handle.ti.ti-point-filled');
  if (!handleElement) return;
  
  // 如果已经有观察器，先断开
  const existingObserver = (handleElement as any).__colorObserver;
  if (existingObserver) {
    existingObserver.disconnect();
  }
  
  // 创建 MutationObserver 监听 class 变化
  const observer = new MutationObserver(() => {
    // 重新应用颜色样式和图标
    applyBlockHandleColor(blockElement, colorValue, iconValue);
  });
  
  // 开始观察 class 属性变化
  observer.observe(handleElement, {
    attributes: true,
    attributeFilter: ['class']
  });
  
  // 将 observer 存储在元素上
  (handleElement as any).__colorObserver = observer;
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
  for (const panel of viewPanels) {
    const panelId = panel.id;
    
    // 查找该面板的 DOM 元素
    const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`);
    
    if (!panelElement) {
      continue;
    }
    
    // 在该面板内查询所有容器块元素
    const containerElements = panelElement.querySelectorAll('.orca-block.orca-container');
    
    // 筛选出带标签的容器块，并获取第一个标签名
    const taggedBlocksPromises: Promise<{ 
      blockId: string; 
      firstTag: string; 
      aliasBlockId: number; 
      colorValue: string | null; 
      iconValue: string | null;
      colorSource: 'block' | 'tag'; // 标记颜色来源
      domColor: string | null; // DOM 上标签的实际颜色（如果 colorValue 为 null 则为 null）
    } | null>[] = [];
    
    containerElements.forEach((element) => {
      // 查找该容器块下的 .orca-repr-main 元素
      const reprMainElement = element.querySelector('.orca-repr-main');
      
      if (reprMainElement) {
        // 检查 .orca-repr-main 下是否有 .orca-tags
        const tagsElement = reprMainElement.querySelector('.orca-tags');
        
        if (tagsElement) {
          // 获取第一个 .orca-tag 元素
          const firstTagElement = tagsElement.querySelector('.orca-tag');
          
          if (firstTagElement) {
            const dataId = element.getAttribute('data-id');
            const firstTagName = firstTagElement.getAttribute('data-name');
            
            // 读取 DOM 上标签的实际颜色样式
            const computedStyle = window.getComputedStyle(firstTagElement);
            const domColor = computedStyle.color;
            
            if (dataId && firstTagName) {
              // 异步获取块本身和标签的颜色属性
              const promise = (async () => {
                try {
                  const blockIdNum = parseInt(dataId, 10);
                  
                  // 1. 首先获取标签的别名块ID（因为图标总是从标签读取）
                  const result = await orca.invokeBackend("get-blockid-by-alias", firstTagName);
                  const aliasBlockId = result?.id ?? null;
                  
                  if (aliasBlockId == null) {
                    return null; // 没有找到别名块，跳过
                  }
                  
                  // 2. 获取标签的属性（用于读取图标，可能还需要读取颜色）
                  const tagStyleProps = await getBlockStyleProperties(aliasBlockId);
                  
                  // 3. 检查容器块本身是否启用了颜色且有值（最高优先级）
                  const blockStyleProps = await getBlockStyleProperties(blockIdNum);
                  
                  // 如果容器块本身启用了颜色且有值，使用容器块的颜色 + 标签的图标
                  if (blockStyleProps.colorEnabled && blockStyleProps.colorValue) {
                    const finalDomColor = domColor;
                    
                    return {
                      blockId: dataId,
                      firstTag: firstTagName,
                      aliasBlockId: aliasBlockId,
                      colorValue: blockStyleProps.colorValue,
                      iconValue: tagStyleProps.iconValue, // 图标从标签读取
                      colorSource: 'block' as const,
                      domColor: finalDomColor
                    };
                  }
                  
                  // 4. 如果容器块没有颜色值（未启用或值为null），使用标签的颜色 + 标签的图标
                  if (!tagStyleProps.colorEnabled || !tagStyleProps.colorValue) {
                    return null; // 标签也未启用颜色或没有颜色值，跳过
                  }
                  
                  const finalDomColor = domColor;
                  
                  return {
                    blockId: dataId,
                    firstTag: firstTagName,
                    aliasBlockId: aliasBlockId,
                    colorValue: tagStyleProps.colorValue,
                    iconValue: tagStyleProps.iconValue, // 图标从标签读取
                    colorSource: 'tag' as const,
                    domColor: finalDomColor
                  };
                } catch (error) {
                  return null;
                }
              })();
              
              taggedBlocksPromises.push(promise);
            }
          }
        }
      }
    });
    
    // 等待所有异步操作完成
    const allResults = await Promise.all(taggedBlocksPromises);
    
    // 过滤掉 null 值（未启用颜色的块）
    const taggedBlocks = allResults.filter((item): item is { 
      blockId: string; 
      firstTag: string; 
      aliasBlockId: number; 
      colorValue: string | null; 
      iconValue: string | null;
      colorSource: 'block' | 'tag';
      domColor: string | null;
    } => item !== null);
    
    // 只输出启用了颜色的容器块（包含块ID、标签名、别名块ID、颜色值、图标值和DOM颜色）
    if (taggedBlocks.length > 0) {
      console.log(`当前面板 [${panelId}] 的启用颜色的容器块:`, taggedBlocks);
      
      // 为每个启用颜色的块应用样式
      taggedBlocks.forEach(block => {
        if (block.colorValue) {
          // 使用 querySelectorAll 获取所有匹配的元素（处理重复 ID 的情况）
          const blockElements = panelElement.querySelectorAll(`[data-id="${block.blockId}"]`);
          const colorValue = block.colorValue; // 提取出来确保类型为 string
          const iconValue = block.iconValue; // 提取图标值
          blockElements.forEach(blockElement => {
            // 应用无序点颜色样式和图标
            applyBlockHandleColor(blockElement, colorValue, iconValue);
            
            // 监听折叠/展开状态变化
            observeBlockHandleCollapse(blockElement, colorValue, iconValue);
          });
        }
      });
    }
  }
}

export async function load(_name: string) {
  pluginName = _name;

  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  // 注册命令：获取所有面板块ID
  orca.commands.registerCommand(
    `${pluginName}.getAllPanelBlockIds`,
    async () => {
      await getAllPanelBlockIds();
    },
    "获取所有面板的块ID"
  );

  // 插件加载时自动执行一次
  lastPanelsSnapshot = JSON.stringify(orca.state.panels);
  await getAllPanelBlockIds();

  // 监听面板变化
  if (window.Valtio?.subscribe) {
    unsubscribe = window.Valtio.subscribe(orca.state, () => {
      // 使用防抖函数，避免频繁触发
      debounceGetPanelBlockIds();
    });
  }
}

export async function unload() {
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
