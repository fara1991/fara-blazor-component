using Xunit;

// SiteLinks（確認用ホスト）などは静的な設定なので、テストを並列に動かさない（テスト同士が設定を書き換えないように）
[assembly: CollectionBehavior(DisableTestParallelization = true)]
