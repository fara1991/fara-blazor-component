using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using FaraBlazorComponent.Core;
using Microsoft.JSInterop;

namespace FaraBlazorComponent.Razor;

/// <summary>
/// ライト／ダークの状態。localStorage の SiteOptions.StorageKey（JSON。プロパティ "Theme" に "light" か "dark"）に保存する。
/// 同じ JSON の他の項目は消さない（読んで、Theme だけを書き換える）。
/// 描画の前に決める必要があるため、WebAssembly では同期で読む（TryLoadSync）。読めないときは light。
/// 保存と同時に html の data-bs-theme を変える。描画の前の反映は theme-init.js が行う（同じキー・同じ形式）。
/// </summary>
public sealed class SiteThemeState
{
    public const string Light = "light";
    public const string Dark = "dark";

    /// <summary>テーマの値を入れるプロパティ名（pokemon の設定 JSON と同じ）。</summary>
    public const string ThemeProperty = "Theme";

    private readonly IJSRuntime _js;
    private readonly SiteOptions _options;
    private bool _loaded;

    public SiteThemeState(IJSRuntime js, SiteOptions options)
    {
        _js = js;
        _options = options;
    }

    /// <summary>"light" か "dark"。</summary>
    public string Current { get; private set; } = Light;

    public bool IsDark => Current == Dark;

    /// <summary>テーマを変えたとき（MudBlazor のテーマ・スイッチの表示を合わせる）。</summary>
    public event Func<Task>? Changed;

    /// <summary>保存された値を同期で読む（WebAssembly だけ）。読めたら true。描画の前に呼ぶ。</summary>
    [SuppressMessage("Design", "CA1031:Do not catch general exception types",
        Justification = "localStorage が読めない理由（プライベートモード・拒否・JS の例外など）によらず、描画を止めずに light で続ける。")]
    public bool TryLoadSync(IJSInProcessRuntime sync)
    {
        if (_loaded) return true;
        try
        {
            Current = ReadTheme(sync.Invoke<string?>("localStorage.getItem", _options.StorageKey));
            _loaded = true;
        }
        catch (Exception)
        {
            // localStorage が使えない（プライベートモード等）ときは、light のまま
            Current = Light;
        }
        return _loaded;
    }

    /// <summary>保存された値を非同期で読む（同期が使えないときの版）。</summary>
    [SuppressMessage("Design", "CA1031:Do not catch general exception types",
        Justification = "localStorage が読めない理由によらず、描画を止めずに light で続ける。")]
    public async Task InitializeAsync()
    {
        if (_loaded) return;
        try
        {
            Current = ReadTheme(await _js.InvokeAsync<string?>("localStorage.getItem", _options.StorageKey));
        }
        catch (Exception)
        {
            Current = Light;
        }
        _loaded = true;
    }

    public async Task SetAsync(string theme)
    {
        Current = NormalizeTheme(theme);
        _loaded = true;
        try
        {
            var existing = await _js.InvokeAsync<string?>("localStorage.getItem", _options.StorageKey);
            await _js.InvokeVoidAsync("localStorage.setItem", _options.StorageKey, WriteTheme(existing, Current));
        }
        catch (Exception ex) when (ex is JSException or JSDisconnectedException)
        {
            // 保存できなくても、このページの表示は変える（保存の失敗は、次の読み込みでテーマが戻るだけ）
        }
        try
        {
            await _js.InvokeVoidAsync("document.documentElement.setAttribute", "data-bs-theme", Current);
        }
        catch (Exception ex) when (ex is JSException or JSDisconnectedException)
        {
            // JS が使えない・回線が切れたときは、html の属性は変えられない（テーマの保存は上で済んでいる）
        }
        if (Changed is not null) await Changed.Invoke();
    }

    public Task ToggleAsync() => SetAsync(IsDark ? Light : Dark);

    /// <summary>保存された JSON から Theme を取り出す。読めない・無いときは light。</summary>
    public static string ReadTheme(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Light;
        try
        {
            if (JsonNode.Parse(json) is not JsonObject root) return Light;
            foreach (var (key, value) in root)
            {
                if (!string.Equals(key, ThemeProperty, StringComparison.OrdinalIgnoreCase)) continue;
                return NormalizeTheme(value?.GetValue<string>());
            }
            return Light;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
        {
            return Light;
        }
    }

    /// <summary>既存の JSON の Theme だけを書き換えた JSON を返す（他の項目は残す）。既存が壊れていれば、Theme だけの JSON。</summary>
    public static string WriteTheme(string? existingJson, string theme)
    {
        JsonObject root;
        try
        {
            root = (string.IsNullOrWhiteSpace(existingJson) ? null : JsonNode.Parse(existingJson) as JsonObject) ?? new JsonObject();
        }
        catch (JsonException)
        {
            root = new JsonObject();
        }
        foreach (var key in root.Select(kv => kv.Key).Where(k => string.Equals(k, ThemeProperty, StringComparison.OrdinalIgnoreCase)).ToList())
            root.Remove(key);
        root[ThemeProperty] = NormalizeTheme(theme);
        return root.ToJsonString();
    }

    private static string NormalizeTheme(string? theme) => theme == Dark ? Dark : Light;
}
