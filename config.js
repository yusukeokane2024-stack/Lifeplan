// 端末をまたいだ同期(ログイン)の設定(Firebase)。手順: docs/sync-setup.md
// 値が空なら、ログイン機能は表示されず、端末内だけで動きます。
// ※ Web API キーは、ブラウザに置く前提の公開用の値です。データはサーバー側のルール(firebase/firestore.rules)でアカウントごとに守られます。
window.LIFEPLAN_CONFIG = window.LIFEPLAN_CONFIG || {
  firebaseApiKey: "AIzaSyB3XfKMh6JYN0IarfsCelsuGzBYWRj_Xl4",
  firebaseProjectId: "lifeplan-e4c10",
};
