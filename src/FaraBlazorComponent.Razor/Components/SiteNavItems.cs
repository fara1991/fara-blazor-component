namespace FaraBlazorComponent.Razor;

/// <summary>サイドバーの 1 項目。Href は相対パス（"" がホーム）。Icon は MudBlazor のアイコン（Icons.Material.Filled.Home など）。</summary>
/// <param name="Href">移動先（相対パス）。</param>
/// <param name="Label">表示する名前。</param>
/// <param name="Icon">アイコン（MudBlazor の名前）。省略可。</param>
/// <param name="Disabled">選べないとき（未対応の機能など）。true なら押しても何も起きない。</param>
/// <param name="Title">マウスを乗せたときの説明（省略可）。</param>
/// <param name="Exact">現在のページの判定を、Href と完全に同じページだけにする（v1.1.0。既定は false = 下位のページも含む。Href が空のホームは、常に完全一致）。「/guide」と「/guide/basics」のように、項目が入れ子のページを持つとき、上位の項目だけを現在にしたいときに使う。</param>
public sealed record SiteNavItem(string Href, string Label, string? Icon = null, bool Disabled = false, string? Title = null, bool Exact = false);

/// <summary>サイドバーの見出しと、その中の項目。Title が null なら見出しを出さない。</summary>
public sealed record SiteNavGroup(string? Title, IReadOnlyList<SiteNavItem> Items);
