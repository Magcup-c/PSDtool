import { PsdRoot, PsdLayerNode } from '../types';

/**
 * PSDのレイヤーツリー内でレイヤーを移動させる
 */
export function moveLayer(psd: PsdRoot, srcPath: number[], dstPath: number[], position: 'before' | 'after' | 'inside'): PsdRoot | null {
    if (!psd?.children) return null;

    // イミュータビリティを維持するためにツリーをクローン
    const cloneTree = (layers: PsdLayerNode[]): PsdLayerNode[] =>
        layers.map(l => ({ ...l, children: l.children ? cloneTree(l.children) : undefined }));

    const getLayerArray = (children: PsdLayerNode[], path: number[]) => {
        let current = children;
        for (const i of path) {
            if (!current[i].children) current[i].children = [];
            current = current[i].children!;
        }
        return current;
    };

    const newChildren = cloneTree(psd.children);

    // 1. 移動元を削除
    const srcParentPath = srcPath.slice(0, -1);
    const srcIdx = srcPath[srcPath.length - 1];
    const srcArr = srcParentPath.length === 0 ? newChildren : getLayerArray(newChildren, srcParentPath);
    const [srcLayer] = srcArr.splice(srcIdx, 1);

    // 2. 移動先パスの調整（同じ階層内で前方に削除が入った場合）
    let adjDstPath = [...dstPath];
    if (srcParentPath.join('-') === dstPath.slice(0, -1).join('-') && srcIdx < dstPath[dstPath.length - 1]) {
        adjDstPath[adjDstPath.length - 1]--;
    }

    // 3. 移動先に挿入
    const dstParentPath = adjDstPath.slice(0, -1);
    const dstArr = adjDstPath.length === 0 ? newChildren : (position === 'inside' ? getLayerArray(newChildren, adjDstPath) : getLayerArray(newChildren, dstParentPath));
    let idx = adjDstPath[adjDstPath.length - 1];
    if (position === 'after') idx++;
    if (position === 'inside') dstArr.push(srcLayer); else dstArr.splice(idx, 0, srcLayer);

    return { ...psd, children: newChildren };
}