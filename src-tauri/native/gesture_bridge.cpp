#ifndef UNICODE
#define UNICODE
#endif

#ifndef _UNICODE
#define _UNICODE
#endif

// Windows 8 以上（WM_POINTER系）を有効にするための定義
#ifndef WINVER
#define WINVER 0x0602
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif

#include <windows.h>
#include <commctrl.h>
#include <unordered_map>
#include <cmath>

// MSVCでCommctrlを使えるようにリンクを明示
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "user32.lib")

typedef void (CALLBACK *GestureCallback)(int kind, double scale, int dx, int dy, int x, int y);

struct GestureState {
    std::unordered_map<UINT32, POINT> points;
    double last_distance = 0.0;
    POINT last_center = {0, 0};
};

static GestureCallback g_cb = nullptr;

static double get_dist(POINT p1, POINT p2) {
    double dx = static_cast<double>(p2.x - p1.x);
    double dy = static_cast<double>(p2.y - p1.y);
    return std::sqrt(dx * dx + dy * dy);
}

// ... 前回のヘッダー部分は同じ ...

static LRESULT CALLBACK GestureSubclassProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam,
                                            UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {
    GestureState* state = reinterpret_cast<GestureState*>(dwRefData);

    switch (msg) {
    // ★重要：Windowsに「自前でやりたい」と伝える
    case WM_GESTURENOTIFY: {
        GESTURECONFIG config = { 0, GC_ALLGESTURES, 0 };
        // 一旦標準ジェスチャーを無効化して生データ（WM_POINTER）を優先させる設定
        SetGestureConfig(hwnd, 0, 1, &config, sizeof(GESTURECONFIG));
        return DefSubclassProc(hwnd, msg, wparam, lparam);
    }

    case WM_POINTERDOWN:
    case WM_POINTERUPDATE:
    case WM_POINTERUP: {
        UINT32 pointerId = GET_POINTERID_WPARAM(wparam);
        POINTER_INFO pi;
        if (GetPointerInfo(pointerId, &pi)) {
            // PT_TOUCH(2), PT_PEN(3), PT_MOUSE(4), PT_TOUCHPAD(5)
            // デバッグ用に一旦 PT_TOUCH(2) と PT_TOUCHPAD(5) を確実に拾う
            if (pi.pointerType == 5 || pi.pointerType == 2) {
                POINT pt = pi.ptPixelLocation;
                ScreenToClient(hwnd, &pt);

                if (msg == WM_POINTERUP) {
                    if (state) state->points.erase(pointerId);
                } else {
                    if (state) state->points[pointerId] = pt;
                }

                if (state && state->points.size() == 2) {
                    auto it = state->points.begin();
                    POINT p1 = it->second;
                    POINT p2 = (++it)->second;

                    double dist = get_dist(p1, p2);
                    POINT center = {(p1.x + p2.x) / 2, (p1.y + p2.y) / 2};

                    if (state->last_distance > 0.0) {
                        double scale = dist / state->last_distance;
                        int dx = center.x - state->last_center.x;
                        int dy = center.y - state->last_center.y;

                        // 閾値を少し下げて反応を良くする
                        if (std::abs(dist - state->last_distance) > 0.5) {
                            if (g_cb) g_cb(1, scale, 0, 0, center.x, center.y);
                        }
                        if (std::abs(dx) > 0 || std::abs(dy) > 0) {
                            if (g_cb) g_cb(2, 0.0, dx, dy, center.x, center.y);
                        }
                    }
                    state->last_distance = dist;
                    state->last_center = center;
                    
                    // 2本指操作中は、Windowsにこれ以上処理させない
                    return 0; 
                } else {
                    if (state) state->last_distance = 0.0;
                }
            }
        }
        break;
    }
    // ... WM_NCDESTROY ...
    }
    return DefSubclassProc(hwnd, msg, wparam, lparam);
}