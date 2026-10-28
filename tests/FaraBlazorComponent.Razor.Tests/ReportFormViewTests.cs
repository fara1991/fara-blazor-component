#pragma warning disable MUD0012
using System.Net;
using System.Text.Json;
using Bunit;
using FaraBlazorComponent.Core;
using FaraBlazorComponent.Razor.Components;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace FaraBlazorComponent.Razor.Tests;

public class ReportFormViewTests : SiteKitTestContext
{
    /// <summary>送信を、テストが決める形で返す偽の HTTP。送った先と内容（JSON）を記録する。</summary>
    private sealed class FakeHandler : HttpMessageHandler
    {
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Respond { get; set; } =
            (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));

        public List<(string Path, string Body)> Sent { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            Sent.Add((request.RequestUri?.AbsolutePath ?? "", body));
            return await Respond(request, cancellationToken);
        }
    }

    private readonly FakeHandler _handler = new();

    public ReportFormViewTests()
    {
        Services.AddSingleton(new HttpClient(_handler) { BaseAddress = new Uri("http://localhost/") });
        JSInterop.Setup<bool>("faraBlazorComponent.report.mount", _ => true).SetResult(true);
        JSInterop.Setup<string>("faraBlazorComponent.report.waitToken", _ => true).SetResult("token-123");
    }

    private IRenderedComponent<ReportFormView> RenderForm(string? from = null, Action<ComponentParameterCollectionBuilder<ReportFormView>>? extra = null) =>
        Render<ReportFormView>(p =>
        {
            if (from is not null) p.Add(c => c.From, from);
            extra?.Invoke(p);
        });

    private static void FillValid(ReportFormView form)
    {
        form.Form.Category = "bug";
        form.Form.Message = "テストの報告です";
    }

    [Fact]
    public void RendersTheFieldsTheHoneypotAndTheSubmitButton()
    {
        var cut = RenderForm();

        Assert.NotNull(cut.Find("#report-message"));
        Assert.NotNull(cut.Find("#report-contact"));
        Assert.NotNull(cut.Find("#fbc-report-turnstile"));
        Assert.NotNull(cut.Find("button.mud-button-filled"));
        Assert.Equal("true", cut.Find(".fbc-report-trap").GetAttribute("aria-hidden"));
        Assert.Equal("-1", cut.Find(".fbc-report-trap input").GetAttribute("tabindex"));
    }

    [Fact]
    public void TheSubmitButtonHasTheClassThatGivesPhonesA44PxTapTarget()
    {
        var cut = RenderForm();

        Assert.Contains("fbc-report-submit", cut.Find("button.mud-button-filled").ClassName);
    }

    [Fact]
    public void TheContentPanelUsesTheCenteredColumnClasses()
    {
        var cut = RenderForm();

        Assert.NotNull(cut.Find(".fbc-page-header.fbc-page-column"));
        Assert.NotNull(cut.Find(".fbc-pane-scroll.fbc-page-pane .fbc-report-card"));
    }

    [Fact]
    public void NoIndexIsOnByDefault()
    {
        var cut = RenderForm();

        Assert.True(cut.Instance.NoIndex);
    }

    [Fact]
    public void WhenTheServiceIsOffTheFormIsDisabledWithTheNote()
    {
        JSInterop.Setup<bool>("faraBlazorComponent.report.mount", _ => true).SetResult(false);

        var cut = RenderForm(extra: p => p.Add(c => c.UnavailableNote, "お急ぎの場合は、フッターから連絡してください。"));

        cut.WaitForAssertion(() => Assert.Contains("いまは報告を受け付けていません", cut.Markup));
        Assert.Contains("お急ぎの場合は", cut.Markup);
        Assert.True(cut.Find("button.mud-button-filled").HasAttribute("disabled"));
    }

    [Fact]
    public void ProblemsAreShownWithoutSendingAnything()
    {
        var cut = RenderForm();

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("種類を選んでください", cut.Markup));
        Assert.Empty(_handler.Sent);
    }

    [Fact]
    public void AMessageOverTheLimitIsRejected()
    {
        var cut = RenderForm();
        FillValid(cut.Instance);
        cut.Instance.Form.Message = new string('a', ReportForm.MaxMessage + 1);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("2000 文字までにしてください", cut.Markup));
        Assert.Empty(_handler.Sent);
    }

    [Fact]
    public void AFailedTokenWaitSaysTheConfirmationCouldNotBeLoadedAndSendsNothing()
    {
        // 確認の部品の待ち合わせが例外（JS の失敗）のとき、「確認が終わっていません」ではなく、部品が使えなかったことを案内する
        JSInterop.Setup<string>("faraBlazorComponent.report.waitToken", _ => true).SetException(new JSException("確認の部品が無い"));
        var cut = RenderForm(from: "/damage-calculator");
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("確認の部品を読み込めませんでした", cut.Markup));
        Assert.DoesNotContain("確認が終わっていません", cut.Markup);
        Assert.Empty(_handler.Sent);
    }

    [Fact]
    public void SuccessPostsTheReportWithTheTokenAndShowsThanks()
    {
        var cut = RenderForm(from: "/damage-calculator");
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));
        var (path, body) = Assert.Single(_handler.Sent);
        Assert.Equal("/api/report", path);
        using var json = JsonDocument.Parse(body);
        Assert.Equal("bug", json.RootElement.GetProperty("category").GetString());
        Assert.Equal("token-123", json.RootElement.GetProperty("turnstileToken").GetString());
        Assert.Equal("/damage-calculator", json.RootElement.GetProperty("page").GetString());
    }

    [Fact]
    public void AnUnsafeFromPathIsNotSent()
    {
        var cut = RenderForm(from: "//evil.example/x");
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Single(_handler.Sent));
        using var json = JsonDocument.Parse(_handler.Sent[0].Body);
        Assert.Equal("", json.RootElement.GetProperty("page").GetString());
    }

    [Fact]
    public void StartOverShowsTheFormAgain()
    {
        var cut = RenderForm();
        FillValid(cut.Instance);
        cut.Find("button.mud-button-filled").Click();
        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));

        cut.Find("button.mud-button-outlined").Click();

        cut.WaitForAssertion(() => Assert.NotNull(cut.Find("#report-message")));
        Assert.Equal("", cut.Instance.Form.Message);
    }

    [Fact]
    public void ServerErrorShowsItsMessage()
    {
        _handler.Respond = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Content = new StringContent("{\"message\":\"少し待ってから送ってください\"}"),
        });
        var cut = RenderForm();
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("少し待ってから送ってください", cut.Markup));
        Assert.NotNull(cut.Find("#report-message"));
    }

    [Fact]
    public void ADailyLimitShowsTheWorkersMessageAndNotAGenericFailure()
    {
        _handler.Respond = (_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)429)
        {
            Content = new StringContent("{\"error\":\"rate_limited\",\"message\":\"1 日の送信上限（3 回）に達しました。明日もう一度お試しください。\"}"),
        });
        var cut = RenderForm();
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("1 日の送信上限（3 回）に達しました", cut.Markup));
        Assert.DoesNotContain("送信に失敗しました", cut.Markup);
    }

    [Fact]
    public void ADailyLimitWithoutAReadableMessageShowsTheDailyLimitText()
    {
        _handler.Respond = (_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)429)
        {
            Content = new StringContent("<html>Too Many Requests</html>"),
        });
        var cut = RenderForm();
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("1 日の送信上限（3 回）に達しました。明日もう一度お試しください。", cut.Markup));
    }

    [Fact]
    public void TimeoutShowsTheTimeoutMessageInsteadOfFailing()
    {
        _handler.Respond = async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10), ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        };
        var cut = RenderForm(extra: p => p.Add(c => c.Timeout, TimeSpan.FromMilliseconds(50)));
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("時間がかかりすぎました", cut.Markup), TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void NetworkErrorShowsTheCommunicationMessage()
    {
        _handler.Respond = (_, _) => throw new HttpRequestException("offline");
        var cut = RenderForm();
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("通信できませんでした", cut.Markup));
    }

    [Fact]
    public void WhileSendingTheButtonSaysSendingAndIsDisabled()
    {
        var gate = new TaskCompletionSource<HttpResponseMessage>();
        _handler.Respond = (_, _) => gate.Task;
        var cut = RenderForm();
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("送信中…", cut.Markup));
        Assert.True(cut.Find("button.mud-button-filled").HasAttribute("disabled"));

        gate.SetResult(new HttpResponseMessage(HttpStatusCode.OK));
        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));
    }

    [Fact]
    public void TheContactIsOptionalByDefaultAndTheLabelSaysSo()
    {
        var cut = RenderForm();

        Assert.Contains("連絡先（任意）", cut.Find("label[for=report-contact]").TextContent);
        Assert.Contains("返信が欲しいときだけ", cut.Markup);
        FillValid(cut.Instance);
        cut.Find("button.mud-button-filled").Click();
        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));
    }

    [Fact]
    public void ARequiredContactUsesTheGivenLabelAndBlocksAnEmptyContact()
    {
        var cut = RenderForm(extra: p =>
        {
            p.Add(c => c.ContactRequired, true);
            p.Add(c => c.ContactFormat, ReportContactFormat.XHandle);
            p.Add(c => c.ContactLabel, "X のユーザー名（@○○）");
            p.Add(c => c.ContactHint, "@ に続けて書いてください。");
            p.Add(c => c.ContactPlaceholder, "@example");
        });
        Assert.Equal("X のユーザー名（@○○）（必須）", cut.Find("label[for=report-contact]").TextContent.Trim());
        Assert.Contains("@ に続けて書いてください。", cut.Markup);
        Assert.Contains("@example", cut.Markup);
        FillValid(cut.Instance);

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("X のユーザー名（@○○）を入力してください", cut.Markup));
        Assert.Empty(_handler.Sent);
    }

    [Fact]
    public void AnInvalidXHandleIsRejectedAndAValidOneIsSent()
    {
        var cut = RenderForm(extra: p =>
        {
            p.Add(c => c.ContactRequired, true);
            p.Add(c => c.ContactFormat, ReportContactFormat.XHandle);
        });
        FillValid(cut.Instance);
        cut.Instance.Form.Contact = "game_fara";

        cut.Find("button.mud-button-filled").Click();

        cut.WaitForAssertion(() => Assert.Contains("1〜15 文字", cut.Markup));
        Assert.Empty(_handler.Sent);

        cut.Instance.Form.Contact = "@game_fara";
        cut.Find("button.mud-button-filled").Click();
        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));
        using var json = JsonDocument.Parse(Assert.Single(_handler.Sent).Body);
        Assert.Equal("@game_fara", json.RootElement.GetProperty("contact").GetString());
    }

    [Fact]
    public void TheContactRulesSurviveStartingOver()
    {
        var cut = RenderForm(extra: p => p.Add(c => c.ContactRequired, true));
        FillValid(cut.Instance);
        cut.Instance.Form.Contact = "me@example.com";
        cut.Find("button.mud-button-filled").Click();
        cut.WaitForAssertion(() => Assert.Contains("送信しました", cut.Markup));

        cut.Find("button.mud-button-outlined").Click();

        Assert.True(cut.Instance.Form.ContactRequired);
    }

    [Fact]
    public void ARequiredContactDoesNotShowMudBlazorsOwnEnglishRequiredErrorOnBlur()
    {
        var cut = RenderForm(extra: p => p.Add(c => c.ContactRequired, true));

        cut.Find("#report-contact").Blur();

        Assert.DoesNotContain("Required", cut.Markup, StringComparison.Ordinal);
        Assert.Empty(cut.FindAll(".mud-input-helper-text"));
    }

    [Fact]
    public void ItsTitleIsAnH1ByDefaultSoThePageHasOneHeading()
    {
        var cut = RenderForm();

        var heading = cut.Find(".fbc-page-header h1");
        Assert.Equal("問い合わせ", heading.TextContent);
        Assert.Empty(cut.FindAll("h3"));
    }

    [Fact]
    public void TheTitleHeadingLevelCanBeChangedWhenTheSitePageAlreadyHasAnH1()
    {
        var cut = RenderForm(extra: p => p.Add(c => c.HeadingLevel, 2));

        Assert.Equal("問い合わせ", cut.Find(".fbc-page-header h2.fbc-page-title").TextContent);
        Assert.Empty(cut.FindAll("h1"));
    }

    [Fact]
    public void AnOutOfRangeHeadingLevelFallsBackToH1()
    {
        var cut = RenderForm(extra: p => p.Add(c => c.HeadingLevel, 9));

        Assert.NotEmpty(cut.FindAll(".fbc-page-header h1"));
    }

    [Fact]
    public void ARequiredContactMarksTheInputRequiredForAssistiveTechnologyAndAnOptionalOneDoesNot()
    {
        var required = RenderForm(extra: p => p.Add(c => c.ContactRequired, true));
        var input = required.Find("#report-contact");
        Assert.Equal("true", input.GetAttribute("aria-required"));

        var optional = RenderForm();
        var plain = optional.Find("#report-contact");
        Assert.NotEqual("true", plain.GetAttribute("aria-required"));
    }
}
