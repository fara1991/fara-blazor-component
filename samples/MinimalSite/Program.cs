using FaraSiteKit.Core;
using MinimalSite;
using FaraSiteKit.Razor;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
var baseAddress = builder.HostEnvironment.BaseAddress;

// サイトの設定（名前・作者・SNS・保存のキー）。SiteOptions の既定は空なので、ここで決める
builder.Services.AddFaraSiteKit(options =>
{
    options.Name = "Minimal Site";
    options.Author = "Sample";
    options.PublishedYear = 2026;
    options.AuthorHomeUrl = "https://example.com/";
    options.Social.Add(new SiteSocialLink("github", "https://example.com/github"));
});
builder.Services.AddSingleton(new HttpClient { BaseAddress = new Uri(baseAddress) });

// メンテナンスの状態（/api/maintenance）。読めなければ通常
var http = new HttpClient { BaseAddress = new Uri(baseAddress) };
builder.Services.AddSingleton(await MaintenanceInfo.LoadAsync(http));

builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

await builder.Build().RunAsync();
