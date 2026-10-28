namespace FaraSiteKit.Razor;

/// <summary>
/// SNS の名前と色（kit が持つ目録）。URL は持たない（サイトが SiteOptions.Social に入れる）。
/// 色は、ポートフォリオ（fara-labs.com）の .service-* と同じ。Discord は Discord の公式の色。
/// </summary>
public static class SocialServices
{
    public sealed record Service(string Name, string Label, string Color);

    public static readonly IReadOnlyList<Service> All = new[]
    {
        new Service("github", "GitHub", "#6e40c9"),
        new Service("twitter", "Twitter", "#1d9bf0"),
        new Service("twitch", "Twitch", "#9146ff"),
        new Service("discord", "Discord", "#5865f2"),
    };

    /// <summary>名前から探す。知らない名前は、名前をそのままラベルにし、既定の色にする（アイコンは GitHub の図形）。</summary>
    public static Service Find(string name) =>
        All.FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase))
        ?? new Service(name, name, "#7c3aed");
}
