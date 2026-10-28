using System.Text.Json;

namespace FaraBlazorComponent.Core;

/// <summary>連絡先の欄に書く内容の形（検査の種類）。</summary>
public enum ReportContactFormat
{
    /// <summary>自由な文字列（メールアドレス・SNS の ID など。長さだけ検査する）。既定。</summary>
    Any,

    /// <summary>X（Twitter）のユーザー名。<c>@</c> に続けて、英数字とアンダースコアを 1〜15 文字（例: <c>@game_fara</c>）。</summary>
    XHandle,
}

/// <summary>
/// 「作者へ報告」の入力（各サイトの報告画面に置く）。送り先は同じサイトの POST /api/report（worker/report.js と同じ形）。
/// 長さ・種類の制限は、サーバー側（worker/report.js）と同じにしておく（先にここで確かめて、無駄な通信をしない）。
/// </summary>
public sealed class ReportForm
{
    public const int MaxMessage = 2000;
    public const int MinMessage = 5;
    public const int MaxContact = 200;

    /// <summary>種類の ID（サーバーの CATEGORIES と同じ）と、画面に出す名前。</summary>
    public static readonly IReadOnlyList<(string Id, string Label)> Categories = new[]
    {
        ("bug", "不具合"),
        ("request", "要望・提案"),
        ("other", "その他"),
    };

    /// <summary>X のユーザー名（<c>@</c> を含む）。<c>@</c> + 英数字とアンダースコア 1〜15 文字。</summary>
    public static bool IsXHandle(string? text) =>
        text is { Length: >= 2 and <= 16 } && text[0] == '@' && text.Skip(1).All(c => char.IsAsciiLetterOrDigit(c) || c == '_');

    /// <summary>連絡先を必須にするか。既定は任意（従来どおり）。サイトが報告画面で設定する（<c>ReportFormView.ContactRequired</c>）。</summary>
    public bool ContactRequired { get; set; }

    /// <summary>連絡先の形の検査。既定は <see cref="ReportContactFormat.Any"/>（長さだけ）。空の連絡先は、必須でなければ形を検査しない。</summary>
    public ReportContactFormat ContactFormat { get; set; } = ReportContactFormat.Any;

    /// <summary>エラー文に出す連絡先の呼び名。既定は「連絡先」。</summary>
    public string ContactName { get; set; } = "連絡先";

    public string Category { get; set; } = "";
    public string Message { get; set; } = "";
    public string Contact { get; set; } = "";
    /// <summary>人には見えない罠の欄。ボットが埋めたら、サーバーは何も送らずに成功を返す。</summary>
    public string Website { get; set; } = "";
    public string TurnstileToken { get; set; } = "";
    /// <summary>報告のきっかけになったページ（移動してくる前のページ。分からなければ空）。</summary>
    public string Page { get; set; } = "";

    /// <summary>入力の問題を、人が読む文で返す。問題がなければ null。</summary>
    public string? Validate()
    {
        if (!Categories.Any(c => c.Id == Category)) return "種類を選んでください";
        var message = Message.Trim();
        var length = CountCharacters(message);
        if (length < MinMessage) return $"内容を {MinMessage} 文字以上で書いてください";
        if (length > MaxMessage) return $"内容は {MaxMessage} 文字までにしてください（いま {length} 文字）";
        var contact = Contact.Trim();
        if (ContactRequired && contact.Length == 0) return $"{ContactName}を入力してください";
        if (CountCharacters(contact) > MaxContact) return $"{ContactName}は {MaxContact} 文字までにしてください";
        if (ContactFormat == ReportContactFormat.XHandle && contact.Length > 0 && !IsXHandle(contact))
            return $"{ContactName}は、@ に続けて英数字とアンダースコア（_）を 1〜15 文字で入力してください（例: @game_fara）";
        if (string.IsNullOrEmpty(TurnstileToken)) return "「ロボットではありません」の確認が終わっていません。表示された確認をしてから、もう一度押してください";
        return null;
    }

    /// <summary>
    /// 文字数（コードポイント単位）。絵文字などの、UTF-16 で 2 つになる文字も 1 文字と数える。
    /// サーバー（worker/report.js の clean が Array.from で数える）と同じ数え方。UTF-16 の Length とは違う。
    /// </summary>
    public static int CountCharacters(string? text) => string.IsNullOrEmpty(text) ? 0 : text.EnumerateRunes().Count();

    /// <summary>
    /// サーバーへ送る JSON。非 ASCII を \uXXXX にしない（UnsafeRelaxedJsonEscaping。日本語 2000 文字が約 6 KB で済む）。
    /// この文字列は application/json の本文としてだけ使い、HTML には埋め込まない（埋め込まないので、緩めた escape でも安全）。
    /// </summary>
    public string ToJson() => JsonSerializer.Serialize(new
    {
        category = Category,
        message = Message.Trim(),
        contact = Contact.Trim(),
        page = Page,
        turnstileToken = TurnstileToken,
        website = Website,
    }, JsonOptions);

    private static readonly JsonSerializerOptions JsonOptions = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>?from= で渡されたページ（パス）を、送ってよい形にする。パスでなければ空（外部の URL・スクリプトなどは送らない）。</summary>
    public static string CleanPage(string? from)
    {
        var path = (from ?? "").Trim();
        if (path.Length == 0 || path.Length > 300) return "";
        // 同じサイトのパス（/ から始まり、英数字・- _ / . だけ）だけ
        if (path[0] != '/' || path.StartsWith("//")) return "";
        return path.All(c => char.IsAsciiLetterOrDigit(c) || c is '/' or '-' or '_' or '.') ? path : "";
    }

    /// <summary>サーバーの応答から、画面に出す文を取り出す（{"message": "..."}。読めなければ状態コードに合わせた既定の文）。</summary>
    public static string DescribeFailure(int statusCode, string? responseBody)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(responseBody))
            {
                using var doc = JsonDocument.Parse(responseBody);
                if (doc.RootElement.ValueKind == JsonValueKind.Object
                    && doc.RootElement.TryGetProperty("message", out var message)
                    && message.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(message.GetString()))
                    return message.GetString()!;
            }
        }
        catch (JsonException)
        {
            // 読めない応答は、下の既定の文にする
        }
        return statusCode switch
        {
            413 => "内容が長すぎます。短くして、もう一度お試しください",
            429 => "1 日の送信上限（3 回）に達しました。明日もう一度お試しください。", // Worker の message と同じ文（上限 3 回は report-rate-limit.js の REPORT_DAILY_LIMIT）
            503 => "いまは報告を受け付けていません。しばらくしてからお試しください",
            >= 500 => "送信に失敗しました。しばらくしてからもう一度お試しください",
            _ => "送信できませんでした。入力を確かめて、もう一度お試しください",
        };
    }
}
