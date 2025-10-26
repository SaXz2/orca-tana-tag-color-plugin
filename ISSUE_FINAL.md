# Issue - 通用样式注入 API

## 标题
```
请求添加通用样式注入 API 以解决插件闪烁问题
```

## 正文（直接复制）

```markdown
## 需要什么

请求添加一个通用的 API，允许插件在元素渲染时为指定 class 的元素注入样式，而不需要等到 DOM 创建后再通过 DOM 操作来应用。

## 为什么需要

我在开发 [orca-tana-tag-color-plugin](https://github.com/SaXz2/orca-tana-tag-color-plugin) 时发现，需要在 `orca-block-handle`、`orca-repr-title`、`orca-inline-r-content` 等元素上应用颜色和图标样式。但由于插件无法在渲染阶段注入样式，只能通过 DOM 操作在元素创建后修改。

这导致了一个问题：当块渲染时，用户会先看到一帧未样式化的内容，然后才能看到应用了样式的最终效果，出现明显的视觉闪烁。

**原生实现**（无闪烁）：
- 在渲染时通过 JSX 直接应用样式
- 用户看到的第一帧就是正确样式

**插件实现**（有闪烁）：
- React 渲染 → DOM 创建 → MutationObserver 检测 → 应用样式
- 用户看到一帧未样式化内容后，样式才被应用

## 建议的 API

```typescript
// 为任意 class 的元素在渲染时注入样式
orca.styles.injectStyles({
  // 目标元素的 class 选择器
  selector: ".orca-block-handle",
  
  // 渲染时注入的样式
  onRender: (element, block) => {
    const color = block.properties?.find(p => p.name === "_color")?.value;
    return color ? { color } : null;
  }
});

// 或者更简洁的方式
orca.styles.addStyleRule({
  selector: ".orca-block-handle",
  styles: (block) => {
    // 返回要注入的样式对象
    return block.properties?.find(p => p.name === "_color")?.value 
      ? { color: block.properties.find(p => p.name === "_color").value }
      : null;
  }
});
```

这样插件就能在渲染阶段为任意 class 的元素注入样式，实现零延迟体验。

