// ECharts 按需注册：只引入本仪表盘用到的图表与组件，避免全量打包。
// 只有趋势折线走 ECharts；模型 / 工具分布用 CSS 比例条渲染。
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])
