<template>
  <main class="min-h-screen bg-agent-canvas px-4 py-16 text-agent-ink">
    <article class="mx-auto max-w-2xl space-y-10 text-[15px] leading-7">
      <section class="space-y-3" lang="en">
        <h1 class="text-2xl font-semibold">
          Privacy Policy
        </h1>
        <p>Kuro (askkuro.com) is an internal AI workspace for our operations team.</p>
        <p>
          When you sign in with Google, we read only your Google account's email address, name and profile picture.
          We use them solely to sign you in and to identify your account (for example, showing your name and avatar,
          and letting an administrator approve your access).
        </p>
        <p>
          We use basic profile information for sign-in and account identification, and do not sell it.
          If you separately connect Google data, we request read-only access to your selected Search Console or
          Analytics services, store encrypted authorization tokens on our server, and read the resources you select.
          Connection verification makes a limited read request and does not send the results to a model.
          When you later ask Kuro to analyze this data, relevant query results may be sent to your selected model provider
          and stored with the conversation. Tokens are never sent to the model.
        </p>
        <p>You can disconnect Google data in Plugins to remove saved credentials and resource selections. Existing conversations remain until deleted. Disconnecting does not revoke access in your Google account; use Google’s connection settings for that. To remove your Kuro account and its data, contact your administrator.</p>
      </section>

      <section class="space-y-3" lang="zh-CN">
        <h2 class="text-xl font-semibold">
          隐私说明
        </h2>
        <p>Kuro（askkuro.com）是我们运营团队内部使用的 AI 工作台。</p>
        <p>
          使用 Google 登录时，我们只读取你 Google 账号的邮箱、名字和头像，仅用于登录与账号识别
          （例如显示你的名字和头像、供管理员审核你的使用申请）。
        </p>
        <p>基本资料用于登录与账号识别，不会出售。你另行连接 Google 数据时，我们申请所选 Search Console／Analytics 服务的只读权限，在服务端加密保存授权令牌，并读取你选择的资源。连接验证只进行有界读取，不把结果发送给模型。后续当你要求 Kuro 分析数据时，相关查询结果可能发送给你选择的模型服务商，并随对话保存；授权令牌不会交给模型。</p>
        <p>你可以在插件页断开 Google 数据，删除本站保存的凭据与资源选择；已有聊天记录保留至你删除。断开不会撤销 Google 端授权，可前往 Google 账号连接设置管理。如需删除 Kuro 账号及相关数据，请联系管理员。</p>
      </section>
    </article>
  </main>
</template>
