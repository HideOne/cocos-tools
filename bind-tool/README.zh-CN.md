# Bind Tool

Cocos Creator 3.8.x 编辑器扩展，用于根据当前选中节点自动生成组件绑定脚本。

## 使用

1. 在层级管理器中选中一个节点。
2. 点击菜单 `Bind Tool/绑定节点`。
3. 插件会扫描选中节点及子节点，生成或更新对应 TypeScript 脚本。

规则可通过菜单 `Bind Tool/规则配置` 打开面板编辑。

## 生成规则

- `node` 开头：生成 `Node` 属性。
- `button` 开头：生成 `Button` 属性和点击事件。
- `spine` 开头：生成 `sp.Skeleton` 属性。
- `stop` 开头：当前节点和子节点全部跳过。
- `node_stop` 开头：当前节点生成 `Node` 属性，但不继续扫描子节点。

脚本默认生成到 `assets/src`，并尽量按当前打开的 prefab 或 scene 资源路径镜像目录。

## 自动生成标记

已有脚本只会更新以下标记之间的内容：

```ts
// AUTO_BIND_START
// AUTO_BIND_END

// AUTO_BUTTON_EVENT_START
// AUTO_BUTTON_EVENT_END

// AUTO_BUTTON_HANDLER_START
// AUTO_BUTTON_HANDLER_END
```

如果目标脚本已经存在但缺少标记，插件会停止写入，避免覆盖业务代码。

## 配置

可通过 `Bind Tool/规则配置` 面板维护规则，只需要填写节点名前缀和组件名。默认配置等价于：

```json
{
  "scriptRoot": "assets/src",
  "autoAddButtonComponent": true,
  "overwriteMode": "marker",
  "stopPrefix": "stop",
  "rules": [
    { "prefix": "node", "componentName": "Node", "enabled": true },
    { "prefix": "node_stop", "componentName": "Node", "enabled": true },
    { "prefix": "spine", "componentName": "sp.Skeleton", "enabled": true },
    { "prefix": "button", "componentName": "Button", "enabled": true }
  ]
}
```

## 说明

当前版本会生成脚本、刷新 AssetDB，并尝试把生成的组件挂载到选中节点。节点属性的序列化绑定仍建议在 Cocos 编辑器中验证一次后再纳入生产流程。
