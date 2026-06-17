# PSD Prefab

Cocos Creator 3.8.x extension for converting a PSD asset into a prefab.

## Usage

1. Run `npm install` in this extension folder.
2. Reload the extension in Cocos Creator.
3. Select a `.psd` asset.
4. Use `PSD Prefab/Convert Selected PSD`.

The extension also registers a best-effort PSD asset context menu item named `Convert to Prefab`. If Creator does not show it in the asset right-click menu, use the top menu entry; it uses the current asset selection.

## Output

For:

```text
assets/ui/Login.psd
```

It creates:

```text
assets/ui/Login.prefab
assets/ui/Login/<layer-name>.png
```

Each visible PSD layer becomes a Creator 2.4 node with node content size plus a `Sprite` or `Label` component.
