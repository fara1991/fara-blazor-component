// samples/MinimalSite の新しいナビの出し方（Rail + BottomBar・FullHeight・SiteTopNav。v1.1.0）のレイアウト計測。
// 既定の幅（360・390・768・1024・1440）と既定の規則すべて（tap-target・min-font-size を含む）。
// menuEsc は設定しない: Rail + BottomBar のスマホはハンバーガーを出さない（メニューボタンが無いのが正しい）。ハンバーガーの Esc は layout-check.config.mjs（/）が測る。
export default {
  baseURL: "http://127.0.0.1:8830",
  pages: ["/rail", "/rail/commands", "/full", "/full/worlds", "/topnav", "/topnav/guide"],
  readySelector: ".mud-layout",
};
