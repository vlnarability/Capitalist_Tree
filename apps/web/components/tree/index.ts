/**
 * Tree component barrel — re-export the React wrapper + its props type (P4d).
 *
 * Consumers (the dev demo page, future game UI, etc.) import from here:
 *
 *   import { TreeView, type TreeViewProps } from '@/components/tree';
 *
 * The implementation lives in `./TreeView.tsx`; the props type is declared
 * in `packages/rendering/src/types.ts` (TreeViewProps) so the data contract
 * is owned by the rendering package, not the web app.
 */
export { TreeView } from './TreeView';
export type { TreeViewProps } from './TreeView';
