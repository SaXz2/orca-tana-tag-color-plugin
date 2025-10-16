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
 * 获取别名块的 _color 属性值（如果启用）
 * @returns 颜色值（如 "#eb0000"），如果未启用则返回 null
 */
async function getColorValue(aliasBlockId: number): Promise<string | null> {
  try {
    const block = await orca.invokeBackend("get-block", aliasBlockId);
    
    if (!block || !block.properties || !Array.isArray(block.properties)) {
      return null;
    }
    
    // 查找 name="_color" 的属性
    const colorProperty = block.properties.find(
      (prop: any) => prop.name === "_color"
    );
    
    // 如果没有找到 _color 属性，返回 null
    if (!colorProperty) {
      return null;
    }
    
    // 检查 type 是否等于 1（开启状态）
    if (colorProperty.type !== 1) {
      return null; // type 不等于 1，说明是关闭状态
    }
    
    // 返回颜色值
    return colorProperty.value || null;
  } catch (error) {
    return null;
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
    const taggedBlocksPromises: Promise<{ blockId: string; firstTag: string; aliasBlockId: number; colorValue: string } | null>[] = [];
    
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
            
            if (dataId && firstTagName) {
              // 异步获取别名块ID并检查颜色属性
              const promise = (async () => {
                try {
                  const result = await orca.invokeBackend("get-blockid-by-alias", firstTagName);
                  const aliasBlockId = result?.id ?? null;
                  
                  if (aliasBlockId == null) {
                    return null; // 没有找到别名块，跳过
                  }
                  
                  // 获取颜色值
                  const colorValue = await getColorValue(aliasBlockId);
                  
                  if (!colorValue) {
                    return null; // 未启用颜色或没有颜色值，跳过
                  }
                  
                  return {
                    blockId: dataId,
                    firstTag: firstTagName,
                    aliasBlockId: aliasBlockId,
                    colorValue: colorValue
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
    const taggedBlocks = allResults.filter((item): item is { blockId: string; firstTag: string; aliasBlockId: number; colorValue: string } => item !== null);
    
    // 只输出启用了颜色的容器块（包含块ID、标签名、别名块ID和颜色值）
    if (taggedBlocks.length > 0) {
      console.log(`当前面板 [${panelId}] 的启用颜色的容器块:`, taggedBlocks);
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
