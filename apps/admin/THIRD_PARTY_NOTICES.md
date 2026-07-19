# Third-Party Notices

## Vue Vben Admin

- 上游仓库：<https://github.com/vbenjs/vue-vben-admin>
- 本地只读参考路径：`/Users/ayu/Desktop/vue-vben-admin`
- 参考 commit：`0cd87c170f48e17e7d0bc98ed2623f61a2728971`
- 参考 describe：`v5.7.0-110-g0cd87c170`
- 本地源码状态：clean
- 许可证：MIT
- Copyright (c) 2024-present, Vben

本应用以 Vben `apps/web-antd` 及其 layout、design token、preferences 相关源码作为视觉与交互参考，独立实现当前任务需要的最小后台壳。没有复制 Vben monorepo、完整应用、Logo、演示页面或 404 插画，也没有引入 `@vben/*`、`@vben-core/*` 运行时依赖。

实质性参考或适配范围：

- `src/styles/index.css`：明暗主题颜色、边框、圆角与页面背景层次。
- `src/layouts/AdminLayout.vue`：Sidebar、Header、Route Tabs、Page Content 的固定布局关系。
- `src/components/layout/AdminSidebar.vue`：展开 / 折叠尺寸与菜单视觉状态。
- `src/components/layout/AdminRouteTabs.vue`：固定 Overview、可关闭业务 Tab 的最小交互思路。

### MIT License

Copyright (c) 2024-present, Vben

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
