using MudBlazor;

namespace FaraSiteKit.Razor;

/// <summary>
/// 既定の MudBlazor のテーマ（紫系。pokemon の Shared/MudProviders.razor と同じ色と字体）。サイトは MudProviders の CustomTheme で替えられる。
/// 色の変数（CSS）は wwwroot/css/fara-site-kit.css の :root にある。両方を揃えて変える。
/// </summary>
public static class SiteTheme
{
    private static readonly string[] FontFamily = { "Zen Kaku Gothic New", "system-ui", "-apple-system", "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Meiryo", "sans-serif" };

    public static MudTheme Create() => new()
    {
        PaletteLight = new PaletteLight
        {
            Primary = "#7c3aed",
            PrimaryContrastText = "#ffffff",
            Background = "#f7f4fd",
            Surface = "#ffffff",
            TextPrimary = "#1e1433",
            TextSecondary = "#6b5f8a",
            DrawerBackground = "#1e0e2c",
            AppbarBackground = "#2a1240",
        },
        PaletteDark = new PaletteDark
        {
            Primary = "#a855f7",
            PrimaryContrastText = "#ffffff",
            Background = "#0c0616",
            Surface = "#1a1030",
            TextPrimary = "#f3edff",
            TextSecondary = "#b4a7d1",
            DrawerBackground = "#1e0e2c",
            AppbarBackground = "#2a1240",
        },
        Typography = new Typography
        {
            // 字間は、いまのサイトのまま（MudBlazor の既定は、少し広げる）
            Default = new DefaultTypography { FontFamily = FontFamily, LetterSpacing = "normal" },
            Button = new ButtonTypography { FontFamily = FontFamily, TextTransform = "none", LetterSpacing = "normal", FontWeight = "500" },
        },
        LayoutProperties = new LayoutProperties
        {
            DefaultBorderRadius = "6px",
            AppbarHeight = "56px",
            DrawerWidthLeft = "230px",
            DrawerMiniWidthLeft = "56px",
        },
    };
}
