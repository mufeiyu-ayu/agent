// ECharts 按需注册：只引入本仪表盘用到的图表与组件，避免全量打包。
// 只有趋势图（按状态堆叠的 Run 柱 + Token 折线）走 ECharts；其余卡片是表格或 CSS 比例条。
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])
