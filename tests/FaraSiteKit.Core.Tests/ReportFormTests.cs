using System.Text.Json;
using FaraSiteKit.Core;
using Xunit;

namespace FaraSiteKit.Core.Tests;

/// <summary>「作者へ報告」の入力の確認（ReportForm）。</summary>
public class ReportFormTests
{
    private static ReportForm Valid() => new() { Category = "bug", Message = "ここが動きません", Contact = "", TurnstileToken = "tok" };

    [Fact]
    public void A_complete_form_has_no_problem() => Assert.Null(Valid().Validate());

    [Theory]
    [InlineData("")]
    [InlineData("other-kind")]
    [InlineData("BUG")]
    public void The_category_must_be_one_of_the_known_ones(string category)
    {
        var form = Valid();
        form.Category = category;
        Assert.Contains("種類", form.Validate());
    }

    [Fact]
    public void Categories_match_the_server_names()
    {
        // worker/report.js の CATEGORIES と同じ ID（画面と通知の食い違いを防ぐ）
        Assert.Equal(new[] { "bug", "request", "other" }, ReportForm.Categories.Select(c => c.Id));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("あ")]
    [InlineData("  あいうえ  ")]    // 前後の空白は数えない（4 文字）
    public void A_message_that_is_too_short_is_rejected(string message)
    {
        var form = Valid();
        form.Message = message;
        Assert.Contains("文字以上", form.Validate());
    }

    [Fact]
    public void The_message_limit_counts_trimmed_characters()
    {
        var form = Valid();
        form.Message = new string('あ', ReportForm.MaxMessage);
        Assert.Null(form.Validate());
        form.Message = " " + new string('あ', ReportForm.MaxMessage) + " ";
        Assert.Null(form.Validate());
        form.Message = new string('あ', ReportForm.MaxMessage + 1);
        Assert.Contains("文字までに", form.Validate());
    }

    [Fact]
    public void Emoji_count_as_one_character_like_the_server()
    {
        // 絵文字は UTF-16 で 2 文字だが、サーバー（Array.from）と同じく 1 文字として数える
        var form = Valid();
        form.Message = string.Concat(Enumerable.Repeat("😀", ReportForm.MaxMessage));
        Assert.Null(form.Validate());
        Assert.Equal(ReportForm.MaxMessage, ReportForm.CountCharacters(form.Message));
        form.Message = string.Concat(Enumerable.Repeat("😀", ReportForm.MaxMessage + 1));
        Assert.Contains("2000 文字までに", form.Validate());
        Assert.Contains("いま 2001 文字", form.Validate());
    }

    [Fact]
    public void Minimum_length_also_counts_code_points()
    {
        var form = Valid();
        form.Message = "😀😀😀😀";   // 4 文字（UTF-16 では 8）
        Assert.Contains("5 文字以上", form.Validate());
        form.Message = "😀😀😀😀😀";
        Assert.Null(form.Validate());
    }

    [Fact]
    public void A_long_contact_is_rejected_and_the_check_token_is_required()
    {
        var form = Valid();
        form.Contact = new string('a', ReportForm.MaxContact + 1);
        Assert.Contains("連絡先", form.Validate());
        form = Valid();
        form.TurnstileToken = "";
        Assert.Contains("ロボット", form.Validate());
    }

    [Fact]
    public void Json_uses_the_names_the_server_reads_and_trims_the_text()
    {
        var form = Valid();
        form.Message = "  こんにちは世界  ";
        form.Contact = " me@example.com ";
        form.Page = "/speed-comparison";
        form.Website = "";
        using var doc = JsonDocument.Parse(form.ToJson());
        var root = doc.RootElement;
        Assert.Equal("bug", root.GetProperty("category").GetString());
        Assert.Equal("こんにちは世界", root.GetProperty("message").GetString());
        Assert.Equal("me@example.com", root.GetProperty("contact").GetString());
        Assert.Equal("/speed-comparison", root.GetProperty("page").GetString());
        Assert.Equal("tok", root.GetProperty("turnstileToken").GetString());
        Assert.Equal("", root.GetProperty("website").GetString());
    }

    [Theory]
    [InlineData("/speed-comparison", "/speed-comparison")]
    [InlineData("/", "/")]
    [InlineData("/a/b_c-d.e", "/a/b_c-d.e")]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("speed", "")]                         // パスでないもの
    [InlineData("//evil.example/x", "")]              // 別のサイトを指す形
    [InlineData("https://evil.example/", "")]
    [InlineData("/x?y=1", "")]                        // 英数字・- _ / . 以外を含むもの
    [InlineData("/<script>", "")]
    public void The_page_is_a_plain_path_or_empty(string? from, string expected) => Assert.Equal(expected, ReportForm.CleanPage(from));

    [Fact]
    public void A_too_long_page_is_dropped() => Assert.Equal("", ReportForm.CleanPage("/" + new string('a', 300)));

    [Fact]
    public void Failure_message_comes_from_the_server_when_it_has_one()
    {
        Assert.Equal("内容を 5 文字以上で書いてください", ReportForm.DescribeFailure(400, "{\"error\":\"invalid_message\",\"message\":\"内容を 5 文字以上で書いてください\"}"));
    }

    [Theory]
    [InlineData(413, "", "長すぎ")]
    [InlineData(429, "<html>Too Many Requests</html>", "何度も")]   // Cloudflare のレート制限（本文は HTML）
    [InlineData(503, "not json", "受け付けていません")]
    [InlineData(502, null, "失敗")]
    [InlineData(500, "{\"message\":\"\"}", "失敗")]            // 空の文は使わない
    [InlineData(400, "{\"message\":123}", "入力を確かめて")]       // 文字列でないものは使わない
    [InlineData(403, "[1,2]", "入力を確かめて")]
    public void Failure_message_falls_back_to_a_default_for_the_status(int status, string? body, string expectedPart) =>
        Assert.Contains(expectedPart, ReportForm.DescribeFailure(status, body));
}

