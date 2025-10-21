# Orca 插件中使用 `_icon` 和 `_color` 属性指南

## 概述

Orca 插件可以完全利用 `_icon` 和 `_color` 属性系统来为自定义组件提供视觉定制功能。这个系统对插件开发者是开放的，可以通过标准的 Orca API 来操作。

## 1. 插件中设置属性

### 1.1 设置块属性

```javascript
// 在插件中设置 _icon 和 _color 属性
async function setBlockIconAndColor(blockId, icon, color) {
    await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], [
        {
            name: "_icon",
            type: PropType.Text,
            value: icon
        },
        {
            name: "_color", 
            type: PropType.Text,
            value: color
        }
    ])
}

// 使用示例
await setBlockIconAndColor("block-123", "ti ti-heart", "#ff6b6b")
```

### 1.2 批量设置属性

```javascript
// 批量设置多个块的属性
async function setMultipleBlocksProperties(blockIds, properties) {
    for (const blockId of blockIds) {
        await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], properties)
    }
}

// 使用示例
await setMultipleBlocksProperties(
    ["block-1", "block-2", "block-3"],
    [
        { name: "_icon", type: PropType.Text, value: "ti ti-star" },
        { name: "_color", type: PropType.Text, value: "#ffd700" }
    ]
)
```

## 2. 插件中读取属性

### 2.1 读取单个块的属性

```javascript
// 读取块的 _icon 和 _color 属性
function getBlockIconAndColor(blockId) {
    const block = orca.state.blocks[blockId]
    if (!block) return { icon: null, color: null }
    
    const iconProperty = block.properties?.find(p => p.name === "_icon")
    const colorProperty = block.properties?.find(p => p.name === "_color")
    
    return {
        icon: iconProperty?.value?.toString() || null,
        color: colorProperty?.value?.toString() || null
    }
}

// 使用示例
const { icon, color } = getBlockIconAndColor("block-123")
console.log(`Icon: ${icon}, Color: ${color}`)
```

### 2.2 读取多个块的属性

```javascript
// 批量读取多个块的属性
function getMultipleBlocksProperties(blockIds) {
    return blockIds.map(blockId => {
        const block = orca.state.blocks[blockId]
        if (!block) return { blockId, icon: null, color: null }
        
        const iconProperty = block.properties?.find(p => p.name === "_icon")
        const colorProperty = block.properties?.find(p => p.name === "_color")
        
        return {
            blockId,
            icon: iconProperty?.value?.toString() || null,
            color: colorProperty?.value?.toString() || null
        }
    })
}
```

## 3. 插件中创建自定义组件

### 3.1 基础自定义组件

```javascript
// 插件自定义组件示例
function CustomBlockComponent({ blockId, children, ...props }) {
    const block = orca.state.blocks[blockId]
    if (!block) return null
    
    // 读取 _icon 和 _color 属性
    const iconValue = block.properties?.find(p => p.name === "_icon")?.value?.toString()
    const colorValue = block.properties?.find(p => p.name === "_color")?.value?.toString()
    
    // 计算样式
    const iconStyle = {
        color: colorValue,
        backgroundColor: colorValue ? `oklch(from ${colorValue} calc(l * 1.2) c h / 25%)` : undefined
    }
    
    // 渲染图标
    const iconElement = iconValue ? (
        iconValue.startsWith("ti ") ? (
            <i className={`custom-icon ${iconValue}`} style={iconStyle} />
        ) : (
            <span className="custom-emoji" style={iconStyle}>
                {iconValue}
            </span>
        )
    ) : null
    
    return (
        <div className="custom-block" {...props}>
            {iconElement}
            <div className="custom-content" style={{ color: colorValue }}>
                {children}
            </div>
        </div>
    )
}
```

### 3.2 高级自定义组件

```javascript
// 带属性编辑功能的自定义组件
function EditableCustomBlock({ blockId, onIconChange, onColorChange }) {
    const block = orca.state.blocks[blockId]
    const [isEditing, setIsEditing] = useState(false)
    
    if (!block) return null
    
    const iconValue = block.properties?.find(p => p.name === "_icon")?.value?.toString()
    const colorValue = block.properties?.find(p => p.name === "_color")?.value?.toString()
    
    // 处理图标变化
    const handleIconChange = async (newIcon) => {
        await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], [{
            name: "_icon",
            type: PropType.Text,
            value: newIcon
        }])
        onIconChange?.(newIcon)
    }
    
    // 处理颜色变化
    const handleColorChange = async (newColor) => {
        await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], [{
            name: "_color",
            type: PropType.Text,
            value: newColor
        }])
        onColorChange?.(newColor)
    }
    
    return (
        <div className="editable-custom-block">
            {isEditing ? (
                <div className="edit-controls">
                    <input 
                        type="text"
                        placeholder="图标名称 (如: ti ti-heart)"
                        defaultValue={iconValue || ""}
                        onChange={(e) => handleIconChange(e.target.value)}
                    />
                    <input 
                        type="color"
                        defaultValue={colorValue || "#000000"}
                        onChange={(e) => handleColorChange(e.target.value)}
                    />
                    <button onClick={() => setIsEditing(false)}>完成</button>
                </div>
            ) : (
                <div 
                    className="custom-block-display"
                    onClick={() => setIsEditing(true)}
                >
                    {iconValue && (
                        <span 
                            className="block-icon"
                            style={{ 
                                color: colorValue,
                                backgroundColor: colorValue ? `oklch(from ${colorValue} calc(l * 1.2) c h / 25%)` : undefined
                            }}
                        >
                            {iconValue.startsWith("ti ") ? (
                                <i className={iconValue} />
                            ) : (
                                iconValue
                            )}
                        </span>
                    )}
                    <span style={{ color: colorValue }}>
                        {block.content}
                    </span>
                </div>
            )}
        </div>
    )
}
```

## 4. 插件中的样式工具函数

### 4.1 样式计算工具

```javascript
// 样式计算工具函数
export const StyleUtils = {
    // 计算图标样式
    calculateIconStyle(iconValue, colorValue) {
        if (!iconValue) return {}
        
        const baseStyle = {
            color: colorValue,
            backgroundColor: colorValue ? `oklch(from ${colorValue} calc(l * 1.2) c h / 25%)` : undefined
        }
        
        return {
            isTablerIcon: iconValue.startsWith("ti "),
            className: iconValue.startsWith("ti ") ? `icon ${iconValue}` : "emoji-icon",
            style: baseStyle,
            content: iconValue.startsWith("ti ") ? null : iconValue
        }
    },
    
    // 计算文本样式
    calculateTextStyle(colorValue) {
        return colorValue ? { color: colorValue } : {}
    },
    
    // 计算容器样式
    calculateContainerStyle(colorValue) {
        return {
            borderColor: colorValue,
            boxShadow: colorValue ? `0 0 0 1px ${colorValue}20` : undefined
        }
    }
}
```

### 4.2 属性管理工具

```javascript
// 属性管理工具函数
export const PropertyUtils = {
    // 获取块的所有视觉属性
    getVisualProperties(blockId) {
        const block = orca.state.blocks[blockId]
        if (!block) return null
        
        const properties = block.properties || []
        return {
            icon: properties.find(p => p.name === "_icon")?.value?.toString() || null,
            color: properties.find(p => p.name === "_color")?.value?.toString() || null,
            hide: properties.find(p => p.name === "_hide")?.value || false,
            asAlias: properties.find(p => p.name === "_asAlias")?.value || false
        }
    },
    
    // 设置视觉属性
    async setVisualProperties(blockId, properties) {
        const propertyArray = Object.entries(properties)
            .filter(([key, value]) => value !== null && value !== undefined)
            .map(([key, value]) => ({
                name: `_${key}`,
                type: PropType.Text,
                value: value
            }))
        
        if (propertyArray.length > 0) {
            await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], propertyArray)
        }
    },
    
    // 清除视觉属性
    async clearVisualProperties(blockId) {
        await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], [
            { name: "_icon", type: PropType.Text, value: null },
            { name: "_color", type: PropType.Text, value: null }
        ])
    }
}
```

## 5. 插件中的事件监听

### 5.1 监听属性变化

```javascript
// 监听块属性变化
function useBlockProperties(blockId) {
    const [properties, setProperties] = useState(null)
    
    useEffect(() => {
        const block = orca.state.blocks[blockId]
        if (block) {
            setProperties(PropertyUtils.getVisualProperties(blockId))
        }
    }, [blockId, orca.state.blocks[blockId]])
    
    return properties
}

// 使用示例
function MyPluginComponent({ blockId }) {
    const properties = useBlockProperties(blockId)
    
    if (!properties) return null
    
    return (
        <div>
            <p>图标: {properties.icon || "无"}</p>
            <p>颜色: {properties.color || "无"}</p>
        </div>
    )
}
```

### 5.2 监听状态变化

```javascript
// 使用 Orca 的状态监听
function useOrcaState() {
    const [state, setState] = useState(orca.state)
    
    useEffect(() => {
        const unsubscribe = orca.state.subscribe(setState)
        return unsubscribe
    }, [])
    
    return state
}
```

## 6. 插件中的批量操作

### 6.1 批量设置属性

```javascript
// 批量设置多个块的属性
async function batchSetProperties(operations) {
    const promises = operations.map(async ({ blockId, properties }) => {
        const propertyArray = Object.entries(properties)
            .filter(([key, value]) => value !== null)
            .map(([key, value]) => ({
                name: `_${key}`,
                type: PropType.Text,
                value: value
            }))
        
        if (propertyArray.length > 0) {
            await orca.commands.invokeTopEditorCommand("core.editor.setProperties", null, [blockId], propertyArray)
        }
    })
    
    await Promise.all(promises)
}

// 使用示例
await batchSetProperties([
    { blockId: "block-1", properties: { icon: "ti ti-heart", color: "#ff6b6b" } },
    { blockId: "block-2", properties: { icon: "ti ti-star", color: "#ffd700" } },
    { blockId: "block-3", properties: { icon: "ti ti-bookmark", color: "#4ecdc4" } }
])
```

### 6.2 批量读取属性

```javascript
// 批量读取多个块的属性
function batchGetProperties(blockIds) {
    return blockIds.map(blockId => {
        const block = orca.state.blocks[blockId]
        return {
            blockId,
            ...PropertyUtils.getVisualProperties(blockId)
        }
    })
}
```

## 7. 插件中的高级用法

### 7.1 自定义渲染器

```javascript
// 自定义图标渲染器
function CustomIconRenderer({ icon, color, size = "medium", className = "" }) {
    const { isTablerIcon, style, content } = StyleUtils.calculateIconStyle(icon, color)
    
    const sizeClasses = {
        small: "icon-sm",
        medium: "icon-md", 
        large: "icon-lg"
    }
    
    if (isTablerIcon) {
        return (
            <i 
                className={`${icon} ${sizeClasses[size]} ${className}`}
                style={style}
            />
        )
    } else {
        return (
            <span 
                className={`emoji ${sizeClasses[size]} ${className}`}
                style={style}
            >
                {content}
            </span>
        )
    }
}
```

### 7.2 主题系统集成

```javascript
// 主题系统集成
function ThemedBlock({ blockId, theme = "default" }) {
    const properties = PropertyUtils.getVisualProperties(blockId)
    
    const themeStyles = {
        default: {},
        dark: { filter: "brightness(0.8)" },
        light: { filter: "brightness(1.2)" },
        colorful: { filter: "saturate(1.5)" }
    }
    
    return (
        <div 
            className={`themed-block theme-${theme}`}
            style={themeStyles[theme]}
        >
            <CustomIconRenderer 
                icon={properties.icon}
                color={properties.color}
            />
            <div style={{ color: properties.color }}>
                {orca.state.blocks[blockId]?.content}
            </div>
        </div>
    )
}
```

## 8. 插件开发最佳实践

### 8.1 错误处理

```javascript
// 带错误处理的属性设置
async function safeSetProperties(blockId, properties) {
    try {
        await PropertyUtils.setVisualProperties(blockId, properties)
        return { success: true }
    } catch (error) {
        console.error("设置属性失败:", error)
        return { success: false, error: error.message }
    }
}
```

### 8.2 性能优化

```javascript
// 使用节流优化属性更新
const throttledSetProperties = useCallback(
    throttle(async (blockId, properties) => {
        await PropertyUtils.setVisualProperties(blockId, properties)
    }, 300),
    []
)
```

### 8.3 类型安全

```javascript
// TypeScript 类型定义
interface VisualProperties {
    icon?: string | null
    color?: string | null
    hide?: boolean
    asAlias?: boolean
}

interface BlockWithVisualProperties {
    blockId: string
    properties: VisualProperties
}
```

## 总结

Orca 插件可以完全利用 `_icon` 和 `_color` 属性系统：

1. **设置属性**：使用 `orca.commands.invokeTopEditorCommand` 设置属性
2. **读取属性**：从 `orca.state.blocks` 中读取属性
3. **创建组件**：基于属性值创建自定义组件
4. **样式应用**：使用计算出的样式应用到 DOM 元素
5. **批量操作**：支持批量设置和读取属性
6. **事件监听**：监听属性变化并响应

这个系统为插件开发者提供了强大的视觉定制能力，可以创建丰富的用户界面和交互体验。
