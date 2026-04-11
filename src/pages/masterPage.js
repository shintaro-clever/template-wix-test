// Wix Studio テンプレート — マスターページ Veloコード
// 全ページ共通の処理を記述する
// API Reference: https://www.wix.com/velo/reference/api-overview/introduction

$w.onReady(function () {
    initSmoothScroll();
});

// ── スムーススクロール ──────────────────────────────────────
// ナビゲーションボタンからお問い合わせフォームへスクロール
// 案件に合わせてボタンID・スクロール先IDを変更する
function initSmoothScroll() {
    const scrollTargets = [
        { btn: '#navTrialBtn',   target: '#contactName' },
        { btn: '#navReserveBtn', target: '#contactName' },
    ];

    scrollTargets.forEach(({ btn, target }) => {
        try {
            $w(btn).onClick(() => {
                $w(target).scrollTo();
            });
        } catch (_) {
            // 要素が存在しないページではスキップ
        }
    });
}
