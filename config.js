// 端末をまたいだ同期(ログイン)の設定。Firebase のプロジェクトを作成したら、2つの値を入れてください(手順: docs/sync-setup.md)。
// どちらも空のままなら、ログイン機能は表示されず、これまでどおり端末内だけで動きます。
// ※ Web API キーは、ブラウザに置く前提の公開用の値です。データはサーバー側のルール(firebase/firestore.rules)でアカウントごとに守られます。
window.LIFEPLAN_CONFIG = window.LIFEPLAN_CONFIG || {
  firebaseApiKey: "",     // 例: AIzaSy...(Firebase の「ウェブアプリ」の設定にある apiKey)
  firebaseProjectId: "",  // 例: my-project-12345(projectId)
};
