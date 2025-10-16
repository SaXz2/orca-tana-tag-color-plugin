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
 * 读取所有面板中的容器块 data-id，并筛选出带标签的块及其第一个标签名和别名块ID
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
    const taggedBlocksPromises: Promise<{ blockId: string; firstTag: string; aliasBlockId: number | null }>[] = [];
    
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
              // 异步获取别名块ID
              const promise = (async () => {
                try {
                  const result = await orca.invokeBackend("get-blockid-by-alias", firstTagName);
                  return {
                    blockId: dataId,
                    firstTag: firstTagName,
                    aliasBlockId: result?.id ?? null
                  };
                } catch (error) {
                  return {
                    blockId: dataId,
                    firstTag: firstTagName,
                    aliasBlockId: null
                  };
                }
              })();
              
              taggedBlocksPromises.push(promise);
            }
          }
        }
      }
    });
    
    // 等待所有异步操作完成
    const taggedBlocks = await Promise.all(taggedBlocksPromises);
    
    // 只输出有带标签容器块的面板
    if (taggedBlocks.length > 0) {
      console.log(`当前面板 [${panelId}] 的带标签容器块:`, taggedBlocks);
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
