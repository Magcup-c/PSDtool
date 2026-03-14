import { readPsd } from 'ag-psd';

// メインスレッドから ArrayBuffer を受け取り、readPsd を実行して結果を返す
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    try {
        const psd = readPsd(e.data, {
            skipLayerImageData: false,
            // 合成済み画像は使わないので読み飛ばしてメモリと時間を節約
            skipCompositeImageData: true,
        });
        // canvas オブジェクトは transferable ではないのでそのまま postMessage
        self.postMessage({ ok: true, psd });
    } catch (err) {
        self.postMessage({ ok: false, error: String(err) });
    }
};