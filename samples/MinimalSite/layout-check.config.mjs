// samples/MinimalSite のレイアウト計測（CI の layout-check job が、公開した静的ファイルを 8830 で配って測る）。
// 既定の幅（360・390・768・1024・1440）と既定の規則すべて。tap-target が 0 件であることを確かめる。
export default {
  baseURL: "http://127.0.0.1:8830",
  pages: ["/"],
  readySelector: ".mud-layout",
  // 閉じるボタンは、ドロワーの一番上の .fsk-drawer-close（SiteLayout のスマホのメニュー）。ドロワーがメニューボタンを覆うため、これで閉じる手段を測る
  menuEsc: { buttonSelector: ".fsk-menu-toggle", closeSelector: ".fsk-drawer-close" },
};
