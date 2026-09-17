/**
 * Tree-shaken ECharts build.
 *
 * Importing the full `echarts` bundle costs ~1 MB; registering only the charts
 * and components this product actually renders keeps it around a third of that.
 */
import * as echarts from 'echarts/core';
import {
  BarChart,
  BoxplotChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  MapChart,
  PieChart,
  RadarChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  DataZoomComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  BoxplotChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  MapChart,
  PieChart,
  RadarChart,
  ScatterChart,
  TreemapChart,
  DataZoomComponent,
  GeoComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
]);

export default echarts;
export { echarts };
