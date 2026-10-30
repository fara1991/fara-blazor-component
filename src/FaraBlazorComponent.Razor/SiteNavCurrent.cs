namespace FaraBlazorComponent.Razor;

/// <summary>現在のページがナビの項目かどうかの判定（SiteRailNav・SiteTopNav が aria-current を付けるのに使う）。SiteNavMenu の判定と同じ決まり。</summary>
internal static class SiteNavCurrent
{
    /// <summary>
    /// <paramref name="currentRelative"/> は base からの相対パス（クエリ・# は含めてもよい）。
    /// 項目の Href が空（ホーム）は、そのページにいるときだけ true。それ以外は、Href と同じか、Href の下位のページ（区切りの / を越えた先）で true。exact なら、同じページだけ。
    /// </summary>
    public static bool IsCurrent(string currentRelative, SiteNavItem item) => IsCurrent(currentRelative, item.Href, item.Exact);

    public static bool IsCurrent(string currentRelative, string href, bool exact = false)
    {
        var current = Normalize(currentRelative);
        var target = Normalize(href);
        if (target.Length == 0) return current.Length == 0;
        if (current.Equals(target, StringComparison.OrdinalIgnoreCase)) return true;
        return !exact && current.StartsWith(target + "/", StringComparison.OrdinalIgnoreCase);
    }

    private static string Normalize(string value)
    {
        var path = value.Split('?', '#')[0].Trim();
        if (path.StartsWith("./", StringComparison.Ordinal)) path = path[2..];
        else if (path == ".") path = "";
        return path.Trim('/');
    }
}
