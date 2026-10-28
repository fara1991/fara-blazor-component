using Bunit;
using FaraBlazorComponent.Core;
using Xunit;
using Microsoft.Extensions.DependencyInjection;

namespace FaraBlazorComponent.Razor.Tests;

/// <summary>
/// 部品のテストの共通の土台。JS は Loose（呼ばれたものは受け、設定していないものは既定値を返す）。
/// サイトの設定（SiteOptions）は、テストごとに AddFaraBlazorComponent で入れる。
/// </summary>
public abstract class BlazorComponentTestContext : BunitContext, IAsyncLifetime
{
    protected BlazorComponentTestContext()
    {
        JSInterop.Mode = JSRuntimeMode.Loose;
        Services.AddFaraBlazorComponent(options =>
        {
            options.Name = "テストサイト";
            options.Author = "テスト作者";
            options.PublishedYear = 2026;
            options.AuthorHomeUrl = "https://example.test/";
            options.DevelopHost = "";
        });
    }

    /// <summary>MudBlazor のサービスは非同期に破棄するため、xUnit からは非同期の破棄（DisposeAsync）を呼ばせる。</summary>
    async Task IAsyncLifetime.DisposeAsync() => await base.DisposeAsync();

    Task IAsyncLifetime.InitializeAsync() => Task.CompletedTask;

    /// <summary>localStorage の値を、テスト用に設定する（キーは SiteOptions.StorageKey の既定）。</summary>
    protected void SetStoredTheme(string json)
    {
        JSInterop.Setup<string?>("localStorage.getItem", _ => true).SetResult(json);
    }
}
