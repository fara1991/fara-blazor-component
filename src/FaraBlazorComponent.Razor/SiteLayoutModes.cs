namespace FaraBlazorComponent.Razor;

/// <summary>
/// SiteLayout のナビゲーションの出し方（v1.1.0）。<c>SiteLayout.NavMode</c> に渡す。省略（null）のときは、従来どおり <c>ShowDrawer</c> で決まる。
/// </summary>
public enum NavMode
{
    /// <summary>サイドバー（PC は Mini でマウスを乗せると広がる。スマホは一時的なメニュー）。従来の既定。</summary>
    Drawer,

    /// <summary>
    /// PC は、常に表示する細いアイコンのレール（アイコン + 小さなラベル。広がらず、ハンバーガーも無い。開閉の保存もしない）。
    /// スマホは、<c>BottomBar</c> があれば下のタブバーに任せてメニューを出さない。無ければ、ハンバーガーで開く一時的なメニュー。
    /// </summary>
    Rail,

    /// <summary>サイドバーを使わず、上部ナビ（<c>TopNav</c>）をヘッダーに出す（<c>ShowDrawer="false"</c> と同じ）。</summary>
    Top,

    /// <summary>ナビを出さない（サイドバーも上部ナビも描かない）。</summary>
    None,
}

/// <summary>
/// PC のサイドバーを置く高さ（v1.1.0）。<c>SiteLayout.DrawerClipMode</c> に渡す。スマホには影響しない。
/// MudBlazor の <c>DrawerClipMode</c> と名前が衝突しないよう、型名に Site を付けている。
/// </summary>
public enum SiteDrawerClipMode
{
    /// <summary>サイドバーはヘッダーの下から。ヘッダーは画面の全幅。従来の既定。</summary>
    BelowHeader,

    /// <summary>サイドバーを画面の最上部から全高にし、ヘッダーはサイドバーの右（本文の側）だけにする。</summary>
    FullHeight,
}
