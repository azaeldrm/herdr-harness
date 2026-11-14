// Reading the window's layout, for the mods that need it: a node by id, and whether the sidebar is folded to its rail.
import { layout } from "herdr";

export function find(node, id) {
  // The layout node with this id, if the layout has one.
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Below 160 px the sidebar is its rail, and every sidebar mod draws its narrow form.
export const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
