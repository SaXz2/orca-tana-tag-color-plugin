# Tana自定义属性高级使用指南

## 概述

基于`plugin_usage_guide.md`文档，我们的Tana自定义属性系统现在提供了完整的插件开发工具集，包括属性管理、样式计算、批量操作、性能优化和自定义组件等功能。

## 核心功能

### 1. 属性管理系统

#### 基础属性操作
```typescript
// 设置单个属性
await TanaPropertySystem.setTanaProperties(blockId, {
  color: "#ff6b6b",
  icon: "ti ti-heart"
});

// 获取属性
const properties = TanaPropertySystem.getFinalProperties(block);
console.log(properties.source); // 'tana' | 'native' | 'none'
```

#### 高级属性工具
```typescript
// 获取所有Tana视觉属性
const visualProps = TanaPropertyUtils.getTanaVisualProperties(blockId);

// 安全设置属性（带错误处理）
const result = await TanaPropertyUtils.safeSetTanaProperties(blockId, {
  color: "#ff6b6b",
  icon: "ti ti-star"
});

if (result.success) {
  console.log("设置成功");
} else {
  console.error("设置失败:", result.error);
}
```

### 2. 批量操作

#### 批量设置属性
```typescript
// 批量设置多个块的属性
await TanaPropertyUtils.batchSetTanaProperties([
  { blockId: 123, properties: { color: "#ff6b6b", icon: "ti ti-heart" } },
  { blockId: 456, properties: { color: "#3498db", icon: "ti ti-star" } },
  { blockId: 789, properties: { color: "#e74c3c", icon: "ti ti-folder" } }
]);
```

#### 批量读取属性
```typescript
// 批量读取多个块的属性
const results = TanaPropertyUtils.batchGetTanaProperties([123, 456, 789]);
results.forEach(result => {
  console.log(`块 ${result.blockId}: 颜色=${result.color}, 图标=${result.icon}`);
});
```

### 3. 样式计算系统

#### 基础样式计算
```typescript
// 计算图标样式
const iconStyle = TanaStyleCalculator.calculateIconStyle("ti ti-heart", "#ff6b6b", 'block');

// 计算文本样式
const textStyle = TanaStyleCalculator.calculateTextStyle("#ff6b6b");

// 计算容器样式
const containerStyle = TanaStyleCalculator.calculateContainerStyle("#ff6b6b");
```

#### 高级样式计算
```typescript
// 计算背景色（使用OKLCH颜色空间）
const backgroundColor = TanaStyleCalculator.calculateBackgroundColor("#ff6b6b");
// 结果: "oklch(from #ff6b6b calc(l * 1.2) c h / 25%)"

// 计算内容样式
const contentStyle = TanaStyleCalculator.calculateContentStyle("#ff6b6b");
```

### 4. 自定义组件系统

#### 图标渲染器
```typescript
// 创建自定义图标渲染器
const iconRenderer = TanaCustomComponents.createIconRenderer(
  "ti ti-heart", 
  "#ff6b6b", 
  'large', 
  'custom-class'
);

// 使用渲染器
const iconElement = document.createElement(iconRenderer.element);
iconElement.className = iconRenderer.className;
Object.assign(iconElement.style, iconRenderer.style);
```

#### 主题化块组件
```typescript
// 创建主题化块
const themedBlock = TanaCustomComponents.createThemedBlock(blockId, 'dark');

if (themedBlock) {
  const element = document.querySelector(`[data-id="${blockId}"]`);
  element.className = themedBlock.className;
  Object.assign(element.style, themedBlock.style);
}
```

#### 可编辑块组件
```typescript
// 创建可编辑块
const editableBlock = TanaCustomComponents.createEditableBlock(
  blockId,
  (newIcon) => console.log("图标已更改:", newIcon),
  (newColor) => console.log("颜色已更改:", newColor)
);

if (editableBlock) {
  // 使用处理函数
  await editableBlock.handlers.onIconChange("ti ti-star");
  await editableBlock.handlers.onColorChange("#ffd700");
}
```

### 5. 性能优化

#### 节流属性设置
```typescript
// 创建节流的属性设置函数
const throttledSetProperties = TanaPerformanceUtils.createThrottledSetProperties(blockId, 300);

// 使用节流函数（自动防抖）
throttledSetProperties({ color: "#ff6b6b" });
throttledSetProperties({ color: "#3498db" }); // 只有最后一次会执行
```

#### 清理缓存
```typescript
// 清理节流缓存
TanaPerformanceUtils.clearThrottleCache();
```

## 插件命令

### 基础命令
```typescript
// 设置Tana颜色
await orca.commands.invoke(`${pluginName}.setTanaColor`, blockId, "#ff6b6b");

// 设置Tana图标
await orca.commands.invoke(`${pluginName}.setTanaIcon`, blockId, "ti ti-heart");

// 清除Tana属性
await orca.commands.invoke(`${pluginName}.clearTanaProperties`, blockId);
```

### 高级命令
```typescript
// 批量设置属性
await orca.commands.invoke(`${pluginName}.batchSetTanaProperties`, [
  { blockId: 123, properties: { color: "#ff6b6b", icon: "ti ti-heart" } }
]);

// 获取属性
await orca.commands.invoke(`${pluginName}.getTanaProperties`, blockId);

// 批量获取属性
await orca.commands.invoke(`${pluginName}.batchGetTanaProperties`, [123, 456, 789]);

// 安全设置属性
await orca.commands.invoke(`${pluginName}.safeSetTanaProperties`, blockId, {
  color: "#ff6b6b",
  icon: "ti ti-star"
});
```

## 实际应用场景

### 1. 标签系统管理
```typescript
// 为标签块设置统一的Tana样式
const tagBlocks = [123, 456, 789];
await TanaPropertyUtils.batchSetTanaProperties(
  tagBlocks.map(blockId => ({
    blockId,
    properties: { color: "#3498db", icon: "ti ti-tag" }
  }))
);
```

### 2. 项目状态管理
```typescript
// 根据项目状态设置不同的Tana样式
const projectStatuses = {
  'planning': { color: "#f39c12", icon: "ti ti-clock" },
  'in-progress': { color: "#3498db", icon: "ti ti-play" },
  'completed': { color: "#27ae60", icon: "ti ti-check" },
  'on-hold': { color: "#e74c3c", icon: "ti ti-pause" }
};

for (const [status, style] of Object.entries(projectStatuses)) {
  const blocks = getBlocksByStatus(status);
  await TanaPropertyUtils.batchSetTanaProperties(
    blocks.map(blockId => ({ blockId, properties: style }))
  );
}
```

### 3. 主题切换
```typescript
// 根据主题切换Tana样式
function applyTheme(theme: 'light' | 'dark' | 'colorful') {
  const allBlocks = getAllBlocks();
  
  allBlocks.forEach(blockId => {
    const themedBlock = TanaCustomComponents.createThemedBlock(blockId, theme);
    if (themedBlock) {
      applyThemedStyles(blockId, themedBlock);
    }
  });
}
```

### 4. 实时编辑
```typescript
// 创建实时编辑界面
function createEditableInterface(blockId: number) {
  const editableBlock = TanaCustomComponents.createEditableBlock(
    blockId,
    async (newIcon) => {
      console.log("图标已更新:", newIcon);
      // 更新UI
    },
    async (newColor) => {
      console.log("颜色已更新:", newColor);
      // 更新UI
    }
  );
  
  if (editableBlock) {
    // 创建编辑控件
    createColorPicker(editableBlock.handlers.onColorChange);
    createIconSelector(editableBlock.handlers.onIconChange);
  }
}
```

## 最佳实践

### 1. 错误处理
```typescript
// 始终使用安全设置方法
const result = await TanaPropertyUtils.safeSetTanaProperties(blockId, properties);
if (!result.success) {
  console.error("设置失败:", result.error);
  // 处理错误
}
```

### 2. 性能优化
```typescript
// 使用节流函数处理频繁更新
const throttledUpdate = TanaPerformanceUtils.createThrottledSetProperties(blockId, 300);

// 批量操作而不是单个操作
await TanaPropertyUtils.batchSetTanaProperties(operations);
```

### 3. 内存管理
```typescript
// 在插件卸载时清理缓存
export async function unload() {
  TanaPerformanceUtils.clearThrottleCache();
  // 其他清理操作...
}
```

### 4. 类型安全
```typescript
// 定义类型接口
interface TanaVisualProperties {
  icon?: string | null;
  color?: string | null;
  hide?: boolean;
  asAlias?: boolean;
}

// 使用类型安全的属性设置
await TanaPropertyUtils.setTanaVisualProperties(blockId, {
  icon: "ti ti-heart",
  color: "#ff6b6b"
} as TanaVisualProperties);
```

## 总结

基于`plugin_usage_guide.md`文档，我们的Tana自定义属性系统现在提供了：

1. **完整的属性管理**：支持单个和批量操作
2. **高级样式计算**：基于OKLCH颜色空间
3. **自定义组件系统**：支持主题化和可编辑组件
4. **性能优化**：节流和缓存机制
5. **错误处理**：安全的属性操作
6. **插件命令**：完整的命令接口

这个系统为Orca插件开发提供了强大的Tana风格标签颜色功能，同时保持与原生系统的完全兼容性！
