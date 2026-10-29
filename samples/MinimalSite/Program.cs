using FaraBlazorComponent.Core;
using MinimalSite;
using FaraBlazorComponent.Razor;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
var baseAddress = builder.HostEnvironment.BaseAddress;

// サイトの設定（名前・作者・SNS・保存のキー）。SiteOptions の既定は空なので、ここで決める
builder.Services.AddFaraBlazorComponent(options =>
{
    options.Name = "Minimal Site";
    options.Author = "Sample";
    options.PublishedYear = 2026;
    options.AuthorHomeUrl = "https://example.com/";
    options.Social.Add(new SiteSocialLink("github", "https://example.com/github"));
    options.Social.Add(new SiteSocialLink("twitter", "https://example.com/twitter"));
});
// ファクトリで登録して、アプリの終了時に DI が破棄する
builder.Services.AddSingleton(_ => new HttpClient { BaseAddress = new Uri(baseAddress) });

// メンテナンスの状態（/api/maintenance）。読めなければ通常
MaintenanceInfo maintenance;
using (var http = new HttpClient { BaseAddress = new Uri(baseAddress) })
{
    maintenance = await MaintenanceInfo.LoadAsync(http);
}
builder.Services.AddSingleton(maintenance);

builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

await builder.Build().RunAsync();
