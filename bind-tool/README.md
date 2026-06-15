# Bind Tool

Cocos Creator 3.8.x editor extension that generates component binding scripts from the selected node.

## Usage

1. Select a node in the hierarchy.
2. Run `Bind Tool/Bind Node` from the editor menu.
3. The extension scans the selected node tree and creates or updates the TypeScript script.

Open `Bind Tool/Rules` to edit the prefix rules in a dockable panel.

## Rules

- `node`: creates a `Node` property.
- `button`: creates a `Button` property and click handler.
- `spine`: creates a `sp.Skeleton` property.
- `stop`: skips the node and its children.
- `node_stop`: binds the node but does not scan its children.

Scripts are generated under `assets/src` by default and mirror the current prefab or scene asset path when the editor exposes it.

Existing scripts are updated only inside the auto-generated marker blocks.
