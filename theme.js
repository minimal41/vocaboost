// settings.html で保存したテーマ・フォント設定を全ページに適用する。
// <head>内で、できるだけ早いタイミング（CSS読み込み直後）に同期実行することで、
// 「白い画面が一瞬表示されてからダークモードに切り替わる」ようなチラつきを防ぐ。

// Google Fontsで提供されている日本語対応フォントの一覧（実在確認済み）。
// family: Google Fonts API (https://fonts.googleapis.com/css2?family=...) に渡す正式名称
// label: 設定画面に表示する名前
// category: 絞り込み用のカテゴリ
// weight: Google Fonts CSSに渡すウェイト指定（省略時は400のみ取得）
window.VOCABOOST_GOOGLE_FONTS = [
  // ===== ゴシック体 =====
  { family: "Noto Sans JP", label: "Noto Sans Japanese", category: "ゴシック体", weight: "400;700" },
  { family: "M PLUS 1p", label: "M PLUS 1p", category: "ゴシック体", weight: "400;700" },
  { family: "M PLUS 1", label: "M PLUS 1", category: "ゴシック体", weight: "400;700" },
  { family: "M PLUS 2", label: "M PLUS 2", category: "ゴシック体", weight: "400;700" },
  { family: "M PLUS Rounded 1c", label: "M PLUS Rounded 1c", category: "丸ゴシック", weight: "400;700" },
  { family: "M PLUS Code Latin", label: "M PLUS Code Latin", category: "等幅", weight: "400;700" },
  { family: "Sawarabi Gothic", label: "さわらびゴシック", category: "ゴシック体" },
  { family: "Kosugi", label: "Kosugi", category: "ゴシック体" },
  { family: "Kosugi Maru", label: "Kosugi Maru", category: "丸ゴシック" },
  { family: "Zen Kaku Gothic New", label: "Zen Kaku Gothic New", category: "ゴシック体", weight: "400;700" },
  { family: "Zen Kaku Gothic Antique", label: "Zen Kaku Gothic Antique", category: "ゴシック体", weight: "400;700" },
  { family: "Zen Maru Gothic", label: "Zen Maru Gothic", category: "丸ゴシック", weight: "400;700" },
  { family: "Zen Kurenaido", label: "Zen Kurenaido", category: "ゴシック体" },
  { family: "Murecho", label: "Murecho", category: "ゴシック体", weight: "400;700" },
  { family: "BIZ UDPGothic", label: "BIZ UDPGothic", category: "ゴシック体", weight: "400;700" },
  { family: "BIZ UDGothic", label: "BIZ UDGothic", category: "ゴシック体", weight: "400;700" },
  { family: "DotGothic16", label: "DotGothic16", category: "デザイン書体" },
  { family: "IBM Plex Sans JP", label: "IBM Plex Sans JP", category: "ゴシック体", weight: "400;700" },
  { family: "Yusei Magic", label: "Yusei Magic", category: "ゴシック体" },
  { family: "WDXL Lubrifont JP N", label: "WDXL Lubrifont JP N", category: "デザイン書体" },

  // ===== 明朝体 =====
  { family: "Noto Serif JP", label: "Noto Serif Japanese", category: "明朝体", weight: "400;700" },
  { family: "Shippori Mincho", label: "Shippori Mincho", category: "明朝体", weight: "400;700" },
  { family: "Shippori Mincho B1", label: "Shippori Mincho B1", category: "明朝体", weight: "400;700" },
  { family: "Sawarabi Mincho", label: "さわらび明朝", category: "明朝体" },
  { family: "BIZ UDPMincho", label: "BIZ UDPMincho", category: "明朝体" },
  { family: "BIZ UDMincho", label: "BIZ UDMincho", category: "明朝体" },
  { family: "Hina Mincho", label: "Hina Mincho", category: "明朝体" },
  { family: "Kaisei Tokumin", label: "Kaisei Tokumin", category: "明朝体", weight: "400;700" },
  { family: "Zen Old Mincho", label: "Zen Old Mincho", category: "明朝体", weight: "400;700" },

  // ===== 丸ゴシック =====
  { family: "Kiwi Maru", label: "Kiwi Maru", category: "丸ゴシック" },
  { family: "Tsukimi Rounded", label: "Tsukimi Rounded", category: "丸ゴシック", weight: "400;700" },

  // ===== 手書き・筆文字 =====
  { family: "Yomogi", label: "Yomogi", category: "手書き" },
  { family: "Klee One", label: "Klee One", category: "手書き" },
  { family: "Yuji Syuku", label: "Yuji Syuku", category: "手書き" },
  { family: "Yuji Boku", label: "Yuji Boku", category: "手書き" },
  { family: "Yuji Mai", label: "Yuji Mai", category: "手書き" },
  { family: "Yuji Hentaigana Akari", label: "Yuji Hentaigana Akari", category: "手書き" },
  { family: "Yuji Hentaigana Akebono", label: "Yuji Hentaigana Akebono", category: "手書き" },
  { family: "New Tegomin", label: "New Tegomin", category: "手書き" },

  // ===== デザイン・ディスプレイ書体 =====
  { family: "Kaisei Decol", label: "Kaisei Decol", category: "デザイン書体", weight: "400;700" },
  { family: "Kaisei Opti", label: "Kaisei Opti", category: "デザイン書体", weight: "400;700" },
  { family: "Kaisei HarunoUmi", label: "Kaisei HarunoUmi", category: "デザイン書体", weight: "400;700" },
  { family: "Zen Antique", label: "Zen Antique", category: "デザイン書体" },
  { family: "Zen Antique Soft", label: "Zen Antique Soft", category: "デザイン書体" },
  { family: "Hachi Maru Pop", label: "Hachi Maru Pop", category: "デザイン書体" },
  { family: "Mochiy Pop One", label: "Mochiy Pop One", category: "デザイン書体" },
  { family: "Mochiy Pop P One", label: "Mochiy Pop P One", category: "デザイン書体" },
  { family: "RocknRoll One", label: "RocknRoll One", category: "デザイン書体" },
  { family: "Reggae One", label: "Reggae One", category: "デザイン書体" },
  { family: "Train One", label: "Train One", category: "デザイン書体" },
  { family: "Dela Gothic One", label: "Dela Gothic One", category: "デザイン書体" },
  { family: "Potta One", label: "Potta One", category: "デザイン書体" },
  { family: "Shippori Antique", label: "Shippori Antique", category: "デザイン書体" },
  { family: "Shippori Antique B1", label: "Shippori Antique B1", category: "デザイン書体" },
  { family: "Stick", label: "Stick", category: "デザイン書体" },
  { family: "Rampart One", label: "Rampart One", category: "デザイン書体" },
];

(function () {
  try {
    const theme = localStorage.getItem("vocaboost_theme"); // "dark" | "light" | null
    const font = localStorage.getItem("vocaboost_font");   // "standard" | Google Fontsのfamily名 | null

    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }

    if (font && font !== "standard") {
      // Google Fontsのフォントが選択されている場合、CSSを動的に読み込んで反映する
      const entry = window.VOCABOOST_GOOGLE_FONTS.find(f => f.family === font);
      if (entry) {
        const weightParam = entry.weight ? `:wght@${entry.weight}` : "";
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(entry.family)}${weightParam}&display=swap`;

        // 同じフォントを二重に読み込まないようにする
        if (!document.querySelector(`link[data-vocaboost-font="${entry.family}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.setAttribute("data-vocaboost-font", entry.family);
          document.head.appendChild(link);
        }

        document.documentElement.style.setProperty(
          "--font-family",
          `"${entry.family}", var(--font-standard)`
        );
      }
    } else {
      document.documentElement.setAttribute("data-font", "standard");
    }
  } catch (e) {
    // localStorageが使えない環境でもページ表示は継続する
    console.warn("テーマ設定の読み込みに失敗しました", e);
  }
})();