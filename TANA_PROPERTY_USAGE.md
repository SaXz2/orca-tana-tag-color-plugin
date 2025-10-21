# Tana自定义属性使用指南

## 概述

本插件现在支持Tana自定义属性系统，允许你使用`_tana-color`和`_tana-icon`属性来设置块的颜色和图标，而不会覆盖Orca原生的`_color`和`_icon`属性。

## 核心特性

### 1. 属性优先级
- **Tana属性优先**：`_tana-color`和`_tana-icon`优先级最高
- **原生属性fallback**：如果没有Tana属性，则使用原生的`_color`和`_icon`
- **无冲突**：两种属性系统可以共存

### 2. 自动样式应用
- **基于dom_style_application_mechanism.md**：使用与Orca原生相同的样式计算机制
- **OKLCH颜色空间**：使用现代颜色计算方式
- **实时更新**：属性变化时自动应用样式

## 使用方法

### 1. 设置Tana颜色

```typescript
// 为块设置Tana颜色
await orca.commands.invokeTopEditorCommand(
  "core.editor.setProperties",
  null,
  [blockId],
  [{
    name: "_tana-color",
    type: 1,
    value: "#ff6b6b"
  }]
);
```

### 2. 设置Tana图标

```typescript
// 为块设置Tana图标
await orca.commands.invokeTopEditorCommand(
  "core.editor.setProperties",
  null,
  [blockId],
  [{
    name: "_tana-icon",
    type: 1,
    value: "ti ti-heart"
  }]
);
```

### 3. 使用插件命令

```typescript
// 使用插件提供的便捷命令
await orca.commands.invoke(`${pluginName}.setTanaColor`, blockId, "#ff6b6b");
await orca.commands.invoke(`${pluginName}.setTanaIcon`, blockId, "ti ti-star");
await orca.commands.invoke(`${pluginName}.clearTanaProperties`, blockId);
```

## 样式应用机制

### 1. 颜色计算
```typescript
// 前景色：直接使用设置的颜色
color: "#ff6b6b"

// 背景色：使用OKLCH计算
backgroundColor: "oklch(from #ff6b6b calc(l * 1.2) c h / 25%)"
```

### 2. 图标处理
```typescript
// Tabler图标
icon: "ti ti-heart" → className: "ti ti-heart"

// Emoji图标  
icon: "🔥" → data-icon: "🔥"
```

### 3. 应用范围
- **块句柄**：`.orca-block-handle`元素
- **块标题**：`.orca-repr-title`元素  
- **内联引用**：`.orca-inline[data-type="t"]`元素

## 优先级规则

### 1. 属性优先级
```
_tana-color > _color (原生)
_tana-icon > _icon (原生)
```

### 2. 样式应用优先级
```
Tana属性 > 原生属性 > 默认样式
```

## 实际应用场景

### 1. 标签系统
```typescript
// 为标签块设置Tana颜色和图标
const tagBlockId = 123;
await TanaPropertySystem.setTanaProperties(tagBlockId, {
  color: "#3498db",
  icon: "ti ti-tag"
});
```

### 2. 项目分类
```typescript
// 为项目块设置不同的Tana样式
const projectBlockId = 456;
await TanaPropertySystem.setTanaProperties(projectBlockId, {
  color: "#e74c3c", 
  icon: "ti ti-folder"
});
```

### 3. 状态标记
```typescript
// 为状态块设置Tana样式
const statusBlockId = 789;
await TanaPropertySystem.setTanaProperties(statusBlockId, {
  color: "#f39c12",
  icon: "ti ti-clock"
});
```

## 技术实现

### 1. 属性系统
```typescript
class TanaPropertySystem {
  static readonly TANA_COLOR_PROP = '_tana-color';
  static readonly TANA_ICON_PROP = '_tana-icon';
  
  static async setTanaProperties(blockId: number, properties: {
    color?: string | null;
    icon?: string | null;
  });
  
  static getFinalProperties(block: any): {
    color: string | null;
    icon: string | null;
    source: 'tana' | 'native' | 'none';
  };
}
```

### 2. 样式计算
```typescript
class TanaStyleCalculator {
  static calculateIconStyle(iconValue: string | null, colorValue: string | null, context: 'block' | 'inline' | 'tag');
  static calculateBackgroundColor(colorValue: string): string;
  static calculateContentStyle(colorValue: string | null);
}
```

### 3. 渲染器扩展
```typescript
class TanaRendererExtension {
  static applyTanaStylesToElement(element: Element, blockId: number);
  static applyStylesToBlockElement(element: Element, props: any);
}
```

## 优势

1. **不覆盖原生**：保持Orca原生属性系统完整
2. **优先级控制**：Tana属性优先，原生属性作为fallback
3. **自动应用**：基于Orca原生机制，样式自动应用
4. **一致性**：使用相同的样式计算算法
5. **扩展性**：可以轻松添加更多自定义属性

## 注意事项

1. **属性名称**：使用`_tana-color`和`_tana-icon`作为属性名
2. **类型设置**：属性type必须设置为1（启用状态）
3. **颜色格式**：支持十六进制颜色代码（如`#ff6b6b`）
4. **图标格式**：支持Tabler图标（如`ti ti-heart`）和Emoji
5. **清理属性**：设置为null可以清除属性

这个系统让你可以充分利用Tana风格的标签颜色功能，同时保持与Orca原生系统的完全兼容性！
