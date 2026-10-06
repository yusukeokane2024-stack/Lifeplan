// 端末をまたいだ同期(ログイン)の設定。Supabase のプロジェクトを作成したら、2つの値を入れてください(手順: docs/sync-setup.md)。
// どちらも空のままなら、ログイン機能は表示されず、これまでどおり端末内だけで動きます。
// ※ anon(公開)キーはブラウザに置く前提のキーです。データはサーバー側の設定(RLS)でアカウントごとに守られます。service_role キーは絶対に入れないでください。
window.LIFEPLAN_CONFIG = window.LIFEPLAN_CONFIG || {
  supabaseUrl: "",      // 例: https://xxxxxxxxxxxx.supabase.co
  supabaseAnonKey: "",  // 例: eyJhbGciOi... または sb_publishable_...
};
