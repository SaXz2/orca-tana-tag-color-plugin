// 在 Orca 浏览器控制台中运行这些代码

// 1. 查看所有块的颜色和图标属性
console.log('所有块的颜色和图标:');
Object.entries(orca.state.blocks).forEach(([id, block]) => {
  const colorProp = block.properties?.find(p => p.name === '_color');
  const iconProp = block.properties?.find(p => p.name === '_icon');
  
  if (colorProp || iconProp) {
    console.log(`块 ${id}:`, {
      color: colorProp?.value,
      icon: iconProp?.value
    });
  }
});

// 2. 查看原生样式如何应用
console.log('查找原生样式应用:');
document.querySelectorAll('.orca-block-handle').forEach(handle => {
  const style = handle.style;
  if (style.color || style.backgroundColor) {
    console.log('Handle 样式:', {
      element: handle,
      color: style.color,
      backgroundColor: style.backgroundColor,
      classes: handle.className
    });
  }
});

// 3. 查看 React 组件树（需要 React DevTools）
// 在 React DevTools 中搜索 "aliased" 或 "tag"

// 4. 监听样式变化
const observer = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
      console.log('样式变化:', mutation.target, mutation.target.style.cssText);
    }
  });
});

document.querySelectorAll('.orca-block-handle').forEach(handle => {
  observer.observe(handle, { attributes: true });
});

console.log('已开始监听样式变化');

// 5. 比较原生实现和插件实现
console.log('原生 vs 插件对比:');

// 原生实现（从 DOM 中获取）
const nativeHandle = document.querySelector('.orca-block-handle');
if (nativeHandle) {
  console.log('原生样式:', nativeHandle.style.cssText);
  console.log('原生类名:', nativeHandle.className);
}

// 插件实现（从代码逻辑推断）
console.log('插件样式应用流程:');
console.log('1. 读取块属性: _color, _icon');
console.log('2. 计算颜色: displayColor, bgColorValue');
console.log('3. 应用样式: handle.style.setProperty()');

