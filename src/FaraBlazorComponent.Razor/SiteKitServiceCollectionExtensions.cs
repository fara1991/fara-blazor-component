using FaraBlazorComponent.Core;
using Microsoft.Extensions.DependencyInjection;
using MudBlazor.Services;

namespace FaraBlazorComponent.Razor;

/// <summary>Fara のサイト共通の部品を、DI に登録する（サイトの Program.cs から 1 回呼ぶ）。</summary>
public static class SiteKitServiceCollectionExtensions
{
    /// <summary>
    /// SiteOptions（サイトの設定）・テーマの状態・MudBlazor（通知の位置など、サイト共通の既定）を登録する。
    /// 確認用ホスト（DevelopHost）は、kit の SiteLinks に入れる（フッターなどのリンクの切り替えに使う）。
    /// </summary>
    public static IServiceCollection AddFaraBlazorComponent(this IServiceCollection services, Action<SiteOptions> configure)
    {
        var options = new SiteOptions();
        configure(options);
        services.AddSingleton(options);
        services.AddSingleton<SiteThemeState>();
        SiteLinks.DevelopHost = options.DevelopHost;
        services.AddMudServices(config =>
        {
            // 通知: 画面の右上に、同時に 5 つまで。閉じるボタン付き（pokemon と同じ）
            config.SnackbarConfiguration.PositionClass = MudBlazor.Defaults.Classes.Position.TopRight;
            config.SnackbarConfiguration.MaxDisplayedSnackbars = 5;
            config.SnackbarConfiguration.ShowCloseIcon = true;
            config.SnackbarConfiguration.PreventDuplicates = false;
            config.SnackbarConfiguration.SnackbarVariant = MudBlazor.Variant.Filled;
        });
        return services;
    }
}
