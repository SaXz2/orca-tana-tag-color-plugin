# 如何查看 Orca 原生颜色实现

## 1. 通过浏览器开发者工具查看

### 步骤 1: 打开开发者工具
```javascript
// 在浏览器控制台中运行
chrome.runtime.sendMessage({action: "getOrcaDOM"})
```

### 步骤 2: 检查 DOM 结构
打开 Elements 面板，选择一个应用了颜色和图标的结构块，查看：

```html
<div class="orca-block-handle orca-block-handle-collapsed">
  <!-- 查看这里的 class 和 style -->
  <i class="ti ti-heart" style="color: #ff6b6b; background-color: ..."></i>
</div>
```

### 步骤 3: 检查 React 组件树
在 React DevTools 中，找到对应的组件，查看 props：

```javascript
// 在控制台中检查 Orca 的状态
orca.state.blocks
```

### 步骤 4: 查看 Orca 核心代码
在 Sources 面板中，搜索以下关键词：
- `_color`
- `_icon`
- `aliased-block-icon`
- `orca-aliased-block`

## 2. 查看插件文档

查看项目中的文档：
- `_icon_color_processing_documentation.md` - 原生图标和颜色处理机制
- `dom_style_application_mechanism.md` - DOM 样式应用机制
- `plugin_usage_guide.md` - 插件使用指南

这些文档包含了 Orca 原生实现的详细分析。

## 3. 对比原生实现

### 原生实现流程（从文档中提取）

```
1. 读取块属性 (_color, _icon)
   ↓
2. 在 React 组件中计算样式
   ↓
3. 通过 JSX 直接应用样式
   style={{ color: colorValue, backgroundColor: ... }}
   ↓
4. React 渲染到 DOM
   <i className="ti ti-heart" style="..."></i>
```

### 插件实现流程（当前）

```
1. 读取块属性 (_color, _icon)
   ↓
2. 异步获取数据
   ↓
3. DOM 查询
   ↓
4. 通过 MutationObserver 监听
   ↓
5. 手动应用内联样式
   handleElement.style.setProperty('color', displayColor)
```

## 4. 关键发现

### 原生实现的特点
1. **同步渲染**：样式直接在 React 渲染阶段应用
2. **无 DOM 查询**：不需要 querySelector
3. **无手动样式应用**：React 自动处理
4. **无延迟**：样式立即渲染

### 插件实现的限制
1. **异步获取**：需要 await orca.invokeBackend()
2. **DOM 查询**：需要 querySelector 查找元素
3. **手动应用**：需要手动设置 style
4. **MutationObserver 延迟**：需要等待 DOM 变化

## 5. 改进建议

### 方案 A: 完全绕过 React（当前方案）
- ✅ 不影响 Orca 核心
- ❌ 有延迟问题
- ❌ 需要手动维护样式

### 方案 B: 在渲染阶段注入（推荐）
参考 `dom_style_application_mechanism.md` 中的实现：

```typescript
// 在块渲染时，直接应用样式
function renderBlock(block) {
  const color = block.properties?.find(p => p.name === '_color')?.value;
  const icon = block.properties?.find(p => p.name === '_icon')?.value;
  
  return (
    <div>
      <i className={icon} style={{color}}></i>
    </div>
  );
}
```

但 Orca 可能没有提供这样的扩展点。

### 方案 C: 使用 MutationObserver + 立即应用（已实现）
- ✅ 不影响 Orca 核心
- ✅ 样式立即应用（已修复）
- ❌ 仍需要 DOM 查询

## 6. 实际问题

你可能遇到的问题：
1. **样式延迟**：虽然我们修复了，但可能还存在其他原因
2. **性能问题**：DOM 查询可能很慢
3. **同步问题**：需要等待异步数据获取

建议：
1. 开启调试模式，查看日志
2. 检查是否是数据获取导致的延迟
3. 考虑优化数据获取流程

