namespace FaraSiteKit.Core;

/// <summary>
/// サイトごとの設定（サイト名・作者・URL・SNS・保存のキー）。各サイトが起動時に 1 つ作り、Razor の部品（レイアウト・フッター・報告フォームなど）が読む。
/// 既定値はサイトに依存しない形（空・相対パス）にしてある。サイトの値（名前・作者・URL）は、各サイトが入れる。
/// </summary>
public sealed class SiteOptions
{
    /// <summary>サイト名（ヘッダーの名前・フッター・ページの題名）。</summary>
    public string Name { get; set; } = "";

    /// <summary>作者の名前（フッターの © の横）。</summary>
    public string Author { get; set; } = "";

    /// <summary>サイトを公開した年（フッターの © の年）。</summary>
    public int PublishedYear { get; set; }

    /// <summary>作者のホームページ（フッターの作者名のリンク）。確認用サイトでは SiteLinks.Localize で切り替える。</summary>
    public string AuthorHomeUrl { get; set; } = "";

    /// <summary>ヘッダーの名前を押したときの先（既定はサイトの先頭）。</summary>
    public string HomeHref { get; set; } = "./";

    /// <summary>「問い合わせ」（報告フォーム）のページ。相対パス。</summary>
    public string ReportPath { get; set; } = "report";

    /// <summary>プライバシーポリシーのページ。相対パス。</summary>
    public string PrivacyPath { get; set; } = "privacy";

    /// <summary>報告の送信先（POST）。worker/report.js の形。相対パス。</summary>
    public string ReportApiPath { get; set; } = "api/report";

    /// <summary>報告の設定（確認の鍵の有無）。GET。相対パス。</summary>
    public string ReportConfigPath { get; set; } = "api/report/config";

    /// <summary>設定を保存する localStorage のキー（テーマの Theme を入れる JSON）。theme-init.js と一致させる（data-storage-key）。</summary>
    public string StorageKey { get; set; } = "fara-site-kit.settings";

    /// <summary>PC のサイドバーを隠しているかを保存する localStorage のキー（"1" のとき隠す）。theme-init.js と一致させる（data-sidebar-key）。</summary>
    public string SidebarKey { get; set; } = "fara-site-kit.sidebar-hidden";

    /// <summary>確認用サイトのホスト名（例: pokemon-dev.fara-labs.com）。空なら、リンクを切り替えない。</summary>
    public string DevelopHost { get; set; } = "";

    /// <summary>フッターの SNS。Url が空のものは、出さない（サイトが URL を入れたものだけ出す）。</summary>
    public IList<SiteSocialLink> Social { get; set; } = new List<SiteSocialLink>();

    /// <summary>Url が空でない SNS だけ（フッターに出す順）。</summary>
    public IReadOnlyList<SiteSocialLink> VisibleSocial => Social.Where(s => !string.IsNullOrWhiteSpace(s.Url)).ToList();
}

/// <summary>フッターの SNS の 1 件。Service は kit が持つアイコンの名前（github・twitter・twitch・discord）。</summary>
public sealed record SiteSocialLink(string Service, string Url);
